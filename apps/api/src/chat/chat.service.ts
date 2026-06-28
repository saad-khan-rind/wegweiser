import { Injectable, Logger } from "@nestjs/common";
import { KnowledgeService, Doc } from "../knowledge/knowledge.service";
import { LlmService } from "../llm/llm.service";
import { deidentify, sanitizeTags } from "../common/deidentify";

export interface ChatRequest {
  query: string;
  tags?: string[];
  region?: string;
  language?: string;
  extraContext?: string;
  clarifyingAnswers?: Record<string, string>;
}

export interface Source {
  id?: string;
  title: string;
  origin: string;
  updatedAt: string;
  url?: string;
  relevance?: number;
  accepted?: boolean;
  excerpt?: string;
}

export interface ClarifyingQuestion {
  id: string;
  question: string;
  required: boolean;
  type: string;
  options: { value: string; label: string }[];
}

export interface ChatResponse {
  answer: string;
  cards: { kind: string; title: string; body?: string; meta?: string }[];
  sources: Source[];
  confidence: number;
  escalate: boolean;
  deidentifiedQuery: string;
  provider: string;
  model?: string;
  clarifyingQuestion?: string;
  clarifyingQuestions?: ClarifyingQuestion[];
  needsInput?: boolean;
  trace?: string[];
  resourcesConsidered?: Source[];
}

const ESCALATE_RE = /lawyer|deport|abschieb|denied|rejected|suicide|hurt myself|emergency|police|violence/i;

@Injectable()
export class ChatService {
  private readonly log = new Logger("ChatService");

  constructor(
    private readonly knowledge: KnowledgeService,
    private readonly llm: LlmService,
  ) {}

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const query = deidentify(req.query ?? "");
    const tags = sanitizeTags(req.tags);
    const extra = deidentify(req.extraContext ?? "");
    const clarifyingAnswers = sanitizeClarifyingAnswers(req.clarifyingAnswers);
    const language = detectLanguage(query, req.language);

    // Preferred path: the agentic, self-verifying RAG service.
    const agent = await this.callAgent(query, tags, req.region, language, extra, clarifyingAnswers);
    if (agent) return { ...agent, deidentifiedQuery: query };

    // Fallback path: local retrieve + compose (keeps the demo alive if the
    // agent service is down).
    return this.composeFallback(query, tags, language);
  }

  localSource(id: string): Doc | null {
    return this.knowledge.get(id);
  }

  // ---- Agent service -------------------------------------------------------
  private async callAgent(
    query: string,
    tags: string[],
    region = "",
    language = "en",
    extraContext = "",
    clarifyingAnswers: Record<string, string> = {},
  ): Promise<ChatResponse | null> {
    const ai = process.env.AI_SERVICE_URL?.replace(/\/$/, "");
    if (!ai) return null;
    try {
      const ctrl = new AbortController();
      const timeout = Number(process.env.AGENT_TIMEOUT_MS ?? 200000);
      const t = setTimeout(() => ctrl.abort(), timeout);
      const res = await fetch(`${ai}/agent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query, tags, region, language, extra_context: extraContext, clarifying_answers: clarifyingAnswers,
        }),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!res.ok) throw new Error(`agent status ${res.status}`);
      const d: any = await res.json();
      const citations = Array.isArray(d.citations) ? d.citations : [];
      const sources: Source[] = citations.map((c: any) => ({
        id: c.id || undefined,
        title: c.title,
        origin: c.source ?? "source",
        updatedAt: c.date ?? "",
        url: c.source_type === "integreat_api" && c.id ? `/api/source/${encodeURIComponent(c.id)}` : c.url || (c.id ? `/api/source/${encodeURIComponent(c.id)}` : ""),
        relevance: c.relevance,
        accepted: true,
      }));
      const resourcesConsidered: Source[] = (Array.isArray(d.resources_considered) ? d.resources_considered : []).map((r: any) => ({
        id: r.id || undefined,
        title: r.title,
        origin: r.source ?? r.origin ?? "source",
        updatedAt: r.date ?? "",
        url: r.source_type === "integreat_api" && r.id ? `/api/source/${encodeURIComponent(r.id)}` : r.url || (r.id ? `/api/source/${encodeURIComponent(r.id)}` : ""),
        relevance: r.relevance,
        accepted: Boolean(r.accepted),
        excerpt: r.excerpt ?? "",
      }));
      const clarifyingQuestions: ClarifyingQuestion[] = Array.isArray(d.clarifying_questions)
        ? d.clarifying_questions.map((q: any) => ({
            id: String(q.id ?? ""),
            question: String(q.question ?? ""),
            required: Boolean(q.required ?? true),
            type: String(q.type ?? "single_choice"),
            options: Array.isArray(q.options)
              ? q.options.map((o: any) => ({ value: String(o.value ?? ""), label: String(o.label ?? "") }))
              : [],
          })).filter((q: ClarifyingQuestion) => q.id && q.question)
        : [];
      return {
        answer: d.answer ?? "",
        cards: this.cardsFor(Boolean(d.escalate), language === "de" ? "de" : "en"),
        sources,
        confidence: typeof d.confidence === "number" ? d.confidence : 0.6,
        escalate: Boolean(d.escalate),
        deidentifiedQuery: query,
        provider: d.provider ?? "agent",
        model: d.model ?? "",
        clarifyingQuestion: d.clarifying_question || clarifyingQuestions[0]?.question || undefined,
        clarifyingQuestions,
        needsInput: Boolean(d.needs_input),
        trace: Array.isArray(d.trace) ? d.trace : undefined,
        resourcesConsidered,
      };
    } catch (e) {
      this.log.warn(`Agent service unavailable: ${(e as Error).message}. Falling back.`);
      return null;
    }
  }

  // ---- Fallback (no agent service) ----------------------------------------
  private async composeFallback(query: string, tags: string[], language: "en" | "de"): Promise<ChatResponse> {
    const escalate = ESCALATE_RE.test(query);
    const docs = await this.knowledge.retrieve(query, tags, 3);
    const sources: Source[] = docs.map((d) => ({
      id: d.id,
      title: d.title, origin: d.origin, updatedAt: d.updatedAt,
      url: (d as any).url || `/api/local-source/${encodeURIComponent(d.id)}`,
      accepted: true,
      relevance: d.score ?? 1,
    }));

    if (!docs.length) {
      return {
        answer: language === "de"
          ? "Zusammenfassung\nIch konnte dafür keine sichere Antwort in den offiziellen Quellen finden. Eine Beratungsperson kann helfen."
          : "Summary\nI couldn't find a confident answer in the official sources. A human counselor can help with this.",
        cards: [{ kind: "escalate", title: language === "de" ? "Mit Beratung sprechen" : "Talk to a counselor", body: language === "de" ? "Kostenlos und vertraulich." : "Free and confidential." }],
        sources: [], confidence: 0.2, escalate: true, deidentifiedQuery: query, provider: this.llm.provider,
        model: process.env.OLLAMA_MODEL ?? "",
      };
    }

    const composed = await this.llm.compose(this.systemPrompt(language), this.userPrompt(query, tags, docs, language));
    if (composed && composed.answer) {
      const cards = composed.cards.length ? composed.cards : this.cardsFor(escalate, language);
      return {
        answer: ensureSummary(composed.answer, language), cards, sources,
        confidence: clamp(escalate ? Math.min(composed.confidence, 0.6) : composed.confidence),
        escalate: composed.escalate || escalate, deidentifiedQuery: query, provider: this.llm.provider,
        model: process.env.OLLAMA_MODEL ?? "",
        resourcesConsidered: sources,
      };
    }

    const top = docs[0];
    const fallback = registrationFallback(query, language);
    if (fallback) {
      return {
        answer: fallback,
        cards: this.cardsFor(false, language),
        sources,
        confidence: 0.62,
        escalate: false,
        deidentifiedQuery: query,
        provider: "local",
        model: "",
        resourcesConsidered: sources,
      };
    }
    return {
      answer: language === "de"
        ? "Zusammenfassung\nIch habe relevante Quellen gefunden, kann daraus aber gerade keine sicher geprüfte Antwort formulieren. Bitte lies die Quellen oder frage eine Beratungsperson."
        : "Summary\nI found relevant sources, but I can't safely compose a verified answer from them right now. Please read the sources or ask a counselor.",
      cards: this.cardsFor(true, language), sources,
      confidence: 0.35,
      escalate: true, deidentifiedQuery: query, provider: "mock", model: "",
      resourcesConsidered: sources,
    };
  }

  private systemPrompt(language: "en" | "de"): string {
    const answerLanguage = language === "de" ? "German" : "English";
    return [
      "You are Wegweiser, a migration guidance assistant for newcomers in Germany, built on official sources.",
      "Answer ONLY from the provided sources. If the sources do not answer the question, say so and recommend a human counselor.",
      `Answer in ${answerLanguage}.`,
      "Format the answer with these sections when relevant: Summary, Document checklist, Actionable steps, Booking.",
      "The first section must always be Summary/Zusammenfassung.",
      "Only include booking links when they appear in the provided sources.",
      "Be brief, plain language, no jargon.",
      "Never ask for or use personal data. Never invent facts, offices, dates, or amounts.",
      'Respond as strict JSON: {"answer": string, "cards": [{"kind": "explain|office|appointment|upload|deadline|escalate|checklist|link", "title": string, "body"?: string, "meta"?: string}], "confidence": number(0..1), "escalate": boolean}.',
      "Set escalate=true for legal, medical, or distressing situations.",
    ].join("\n");
  }

  private userPrompt(query: string, tags: string[], docs: Doc[], language: "en" | "de"): string {
    const ctx = docs.map((d, i) => `[${i + 1}] ${d.title} (${d.origin}, updated ${d.updatedAt})\n${d.text}`).join("\n\n");
    return `User question (already de-identified): ${query}\nAnswer language: ${language}\nUser context tags: ${tags.join(", ") || "none"}\n\nSources:\n${ctx}`;
  }

  private cardsFor(escalate: boolean, language: "en" | "de" = "en"): { kind: string; title: string; body?: string; meta?: string }[] {
    const cards: { kind: string; title: string; body?: string; meta?: string }[] = [
      { kind: "explain", title: language === "de" ? "Zeige mir die Schritte" : "Show me the steps" },
      { kind: "office", title: language === "de" ? "Amt in meiner Nähe finden" : "Find the office near me" },
    ];
    if (escalate) cards.push({ kind: "escalate", title: language === "de" ? "Mit Beratung sprechen" : "Talk to a counselor", body: language === "de" ? "Eine Person kann dabei helfen." : "A person can help with this." });
    return cards;
  }
}

function detectLanguage(query: string, requested?: string): "en" | "de" {
  const q = query.toLowerCase();
  if (/[äöüß]/i.test(query)) return "de";
  const germanHits = [" ich ", " kann ", " wie ", " wo ", " was ", " warum ", " anmelden", " ausländer", " arbeit", " brauche", " bekomme", " muss ", " darf "]
    .filter((w) => ` ${q} `.includes(w)).length;
  if (germanHits >= 1) return "de";
  return requested === "de" ? "de" : "en";
}

function clamp(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function ensureSummary(answer: string, language: "en" | "de"): string {
  const text = (answer || "").trim();
  if (/^(summary|zusammenfassung)\b/i.test(text)) return text;
  return `${language === "de" ? "Zusammenfassung" : "Summary"}\n${text}`;
}

function sanitizeClarifyingAnswers(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value !== "string") continue;
    const cleanKey = key.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
    const cleanValue = deidentify(value).slice(0, 240);
    if (cleanKey && cleanValue) out[cleanKey] = cleanValue;
  }
  return out;
}

function registrationFallback(query: string, language: "en" | "de"): string {
  const q = query.toLowerCase();
  if (!/(anmeldung|anmelden|registration|register|address|melde|wohnsitz)/i.test(q)) return "";
  return language === "de"
    ? "Zusammenfassung\nFür die Anmeldung meldest du deine Wohnung bei der zuständigen Meldebehörde oder beim Bürgeramt an.\n\nDokumenten-Checkliste\n- Pass oder Ausweis\n- Wohnungsgeberbestätigung\n\nSchritte\n1. Prüfe die zuständige Meldebehörde oder das Bürgeramt deiner Stadt.\n2. Bereite Pass/Ausweis und Wohnungsgeberbestätigung vor.\n3. Prüfe die Terminseite deiner Stadt, falls ein Termin erforderlich ist."
    : "Summary\nFor city registration, register your address with the local registration office or Bürgeramt.\n\nDocument checklist\n- Passport or ID\n- Landlord confirmation\n\nActionable steps\n1. Check the responsible registration office or Bürgeramt for your city.\n2. Prepare your passport/ID and landlord confirmation.\n3. Check your city appointment page if an appointment is required.";
}
