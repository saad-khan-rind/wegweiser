import { Injectable, Logger } from "@nestjs/common";
import { KnowledgeService, Doc } from "../knowledge/knowledge.service";
import { LlmService } from "../llm/llm.service";
import { AiConfigService } from "../llm/ai-config.service";
import { deidentify, sanitizeTags } from "../common/deidentify";

export interface ChatRequest {
  query: string;
  tags?: string[];
  region?: string;
  language?: string;
  extraContext?: string;
}

export interface Source {
  title: string;
  origin: string;
  updatedAt: string;
  url?: string;
}

export interface ChatResponse {
  answer: string;
  cards: { kind: string; title: string; body?: string; meta?: string }[];
  sources: Source[];
  confidence: number;
  escalate: boolean;
  deidentifiedQuery: string;
  provider: string;
  clarifyingQuestion?: string;
  needsInput?: boolean;
  trace?: string[];
}

const ESCALATE_RE = /lawyer|deport|abschieb|denied|rejected|suicide|hurt myself|emergency|police|violence/i;

@Injectable()
export class ChatService {
  private readonly log = new Logger("ChatService");

  constructor(
    private readonly knowledge: KnowledgeService,
    private readonly llm: LlmService,
    private readonly aiConfig: AiConfigService,
  ) {}

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const query = deidentify(req.query ?? "");
    const tags = sanitizeTags(req.tags);
    const extra = deidentify(req.extraContext ?? "");
    const language = detectLanguage(query, req.language);

    // Preferred path: the agentic, self-verifying RAG service.
    const agent = await this.callAgent(query, tags, req.region, language, extra);
    if (agent) return { ...agent, deidentifiedQuery: query };

    // Fallback path: local retrieve + compose (keeps the demo alive if the
    // agent service is down).
    return this.composeFallback(query, tags, language);
  }

  // ---- Agent service -------------------------------------------------------
  private async callAgent(
    query: string,
    tags: string[],
    region = "",
    language = "en",
    extraContext = "",
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
          query, tags, region, language, extra_context: extraContext,
          gemini_api_key: this.aiConfig.geminiApiKey,
          gemini_model: this.aiConfig.geminiModel,
        }),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!res.ok) throw new Error(`agent status ${res.status}`);
      const d: any = await res.json();
      const citations = Array.isArray(d.citations) ? d.citations : [];
      const sources: Source[] = citations.map((c: any) => ({
        title: c.title, origin: c.source ?? "source", updatedAt: c.date ?? "", url: c.url ?? "",
      }));
      return {
        answer: d.answer ?? "",
        cards: this.cardsFor(Boolean(d.escalate), language === "de" ? "de" : "en"),
        sources,
        confidence: typeof d.confidence === "number" ? d.confidence : 0.6,
        escalate: Boolean(d.escalate),
        deidentifiedQuery: query,
        provider: "agent",
        clarifyingQuestion: d.clarifying_question || undefined,
        needsInput: Boolean(d.needs_input),
        trace: Array.isArray(d.trace) ? d.trace : undefined,
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
      title: d.title, origin: d.origin, updatedAt: d.updatedAt, url: (d as any).url ?? "",
    }));

    if (!docs.length) {
      return {
        answer: language === "de"
          ? "Ich konnte dafür keine sichere Antwort in den offiziellen Quellen finden. Eine Beratungsperson kann helfen."
          : "I couldn't find a confident answer in the official sources. A human counselor can help with this.",
        cards: [{ kind: "escalate", title: language === "de" ? "Mit Beratung sprechen" : "Talk to a counselor", body: language === "de" ? "Kostenlos und vertraulich." : "Free and confidential." }],
        sources: [], confidence: 0.2, escalate: true, deidentifiedQuery: query, provider: this.llm.provider,
      };
    }

    const composed = await this.llm.compose(this.systemPrompt(language), this.userPrompt(query, tags, docs, language));
    if (composed && composed.answer) {
      const cards = composed.cards.length ? composed.cards : this.cardsFor(escalate);
      return {
        answer: composed.answer, cards, sources,
        confidence: clamp(escalate ? Math.min(composed.confidence, 0.6) : composed.confidence),
        escalate: composed.escalate || escalate, deidentifiedQuery: query, provider: this.llm.provider,
      };
    }

    const top = docs[0];
    return {
      answer: language === "de"
        ? "Ich habe relevante Quellen gefunden, kann daraus aber gerade keine sicher geprüfte Antwort formulieren. Bitte lies die Quellen oder frage eine Beratungsperson."
        : "I found relevant sources, but I can't safely compose a verified answer from them right now. Please read the sources or ask a counselor.",
      cards: this.cardsFor(true, language), sources,
      confidence: 0.35,
      escalate: true, deidentifiedQuery: query, provider: "mock",
    };
  }

  private systemPrompt(language: "en" | "de"): string {
    const answerLanguage = language === "de" ? "German" : "English";
    return [
      "You are Wegweiser, a migration guidance assistant for newcomers in Germany, built on Integreat's content.",
      "Answer ONLY from the provided sources. If the sources do not answer the question, say so and recommend a human counselor.",
      `Answer in ${answerLanguage}.`,
      "Be brief: 2-3 sentences maximum, plain language, no jargon.",
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
function firstSentences(text: string, n: number): string {
  return text.split(/(?<=[.!?])\s+/).slice(0, n).join(" ");
}
