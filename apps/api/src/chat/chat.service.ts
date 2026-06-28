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

export interface GuidedFlowPathItem {
  nodeId?: string;
  answerKey?: string;
  question?: string;
  value?: string | number | string[];
  answerLabel?: string;
}

export interface GuidedFlowRequest {
  answers?: Record<string, unknown>;
  path?: GuidedFlowPathItem[];
  region?: string;
  language?: string;
}

export interface GuidedFlowOptionsRequest extends GuidedFlowRequest {
  nodeId?: string;
}

export interface GuidedFlowOption {
  value: string;
  label: string;
  helper?: string;
  icon?: string;
  badge?: string;
  next?: string;
  set?: Record<string, unknown>;
  source?: string;
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

  async guidedRecommendation(req: GuidedFlowRequest): Promise<ChatResponse & { prompt: string; contextPath: GuidedFlowPathItem[] }> {
    const language = req.language === "de" ? "de" : "en";
    const answers = sanitizeGuidedAnswers(req.answers);
    const contextPath = sanitizeGuidedPath(req.path);
    const prompt = guidedPrompt(answers, contextPath, language);
    const extraContext = guidedContext(answers, contextPath, language);
    const tags = guidedTags(answers);

    const agent = await this.callGuidedAgent(answers, contextPath, req.region, language);
    if (agent) return { ...agent, deidentifiedQuery: prompt, prompt, contextPath };

    const fallback = await this.chat({
      query: prompt,
      tags,
      region: req.region,
      language,
      extraContext,
      clarifyingAnswers: stringifyGuidedAnswers(answers),
    });
    return { ...fallback, prompt, contextPath };
  }

  async guidedOptions(req: GuidedFlowOptionsRequest): Promise<{
    nodeId: string;
    options: GuidedFlowOption[];
    generatedAt: string;
    provider: string;
    sources: Source[];
    trace: string[];
  }> {
    const language = req.language === "de" ? "de" : "en";
    const answers = sanitizeGuidedAnswers(req.answers);
    const contextPath = sanitizeGuidedPath(req.path);
    const nodeId = cleanShort(req.nodeId || "");
    const ai = await this.callGuidedOptionsAgent(nodeId, answers, contextPath, req.region, language);
    if (ai) return ai;

    const fallbackOptions = fallbackGuidedOptions(nodeId, answers, language);
    return {
      nodeId,
      options: fallbackOptions,
      generatedAt: new Date().toISOString(),
      provider: "api-safety-fallback",
      sources: [],
      trace: ["AI option service unavailable; returned conservative safety-filtered options"],
    };
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

  private async callGuidedAgent(
    answers: Record<string, unknown>,
    path: GuidedFlowPathItem[],
    region = "",
    language: "en" | "de" = "en",
  ): Promise<ChatResponse | null> {
    const ai = process.env.AI_SERVICE_URL?.replace(/\/$/, "");
    if (!ai) return null;
    try {
      const ctrl = new AbortController();
      const timeout = Number(process.env.AGENT_TIMEOUT_MS ?? 200000);
      const t = setTimeout(() => ctrl.abort(), timeout);
      const res = await fetch(`${ai}/guided-flow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers, path, region, language }),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!res.ok) throw new Error(`guided-flow status ${res.status}`);
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
      return {
        answer: d.answer ?? "",
        cards: this.cardsFor(Boolean(d.escalate), language),
        sources,
        confidence: typeof d.confidence === "number" ? d.confidence : 0.6,
        escalate: Boolean(d.escalate),
        deidentifiedQuery: guidedPrompt(answers, path, language),
        provider: d.provider ?? "guided-agent",
        model: d.model ?? "",
        needsInput: Boolean(d.needs_input),
        trace: Array.isArray(d.trace) ? d.trace : undefined,
        resourcesConsidered,
      };
    } catch (e) {
      this.log.warn(`Guided AI service unavailable: ${(e as Error).message}. Falling back.`);
      return null;
    }
  }

  private async callGuidedOptionsAgent(
    nodeId: string,
    answers: Record<string, unknown>,
    path: GuidedFlowPathItem[],
    region = "",
    language: "en" | "de" = "en",
  ): Promise<{
    nodeId: string;
    options: GuidedFlowOption[];
    generatedAt: string;
    provider: string;
    sources: Source[];
    trace: string[];
  } | null> {
    const ai = process.env.AI_SERVICE_URL?.replace(/\/$/, "");
    if (!ai || !nodeId) return null;
    try {
      const ctrl = new AbortController();
      const timeout = Number(process.env.AGENT_TIMEOUT_MS ?? 200000);
      const t = setTimeout(() => ctrl.abort(), timeout);
      const res = await fetch(`${ai}/guided-flow/options`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeId, answers, path, region, language }),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!res.ok) throw new Error(`guided-flow options status ${res.status}`);
      const d: any = await res.json();
      const options = sanitizeGuidedOptions(d.options, answers, language);
      const sources: Source[] = (Array.isArray(d.sources) ? d.sources : []).map((s: any) => ({
        id: s.id || undefined,
        title: String(s.title ?? "source"),
        origin: String(s.source ?? s.origin ?? "source"),
        updatedAt: String(s.date ?? s.updatedAt ?? ""),
        url: String(s.url ?? ""),
        relevance: typeof s.relevance === "number" ? s.relevance : undefined,
        accepted: Boolean(s.accepted ?? true),
      }));
      return {
        nodeId,
        options,
        generatedAt: String(d.generatedAt ?? new Date().toISOString()),
        provider: String(d.provider ?? "guided-ai"),
        sources,
        trace: Array.isArray(d.trace) ? d.trace.map((x: any) => String(x)) : [],
      };
    } catch (e) {
      this.log.warn(`Guided option service unavailable: ${(e as Error).message}. Falling back.`);
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

function sanitizeGuidedAnswers(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Record<string, unknown> = {};
  for (const [rawKey, rawValue] of Object.entries(input as Record<string, unknown>)) {
    const key = rawKey.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
    if (!key) continue;
    if (typeof rawValue === "string") {
      out[key] = deidentify(rawValue).slice(0, 240);
    } else if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      out[key] = rawValue;
    } else if (Array.isArray(rawValue)) {
      out[key] = rawValue
        .filter((item) => typeof item === "string" || typeof item === "number")
        .map((item) => deidentify(String(item)).slice(0, 120))
        .slice(0, 20);
    } else if (typeof rawValue === "boolean") {
      out[key] = rawValue;
    }
  }
  return out;
}

function sanitizeGuidedPath(input: unknown): GuidedFlowPathItem[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 20).map((item: any) => ({
    nodeId: cleanShort(item?.nodeId),
    answerKey: cleanShort(item?.answerKey),
    question: deidentify(String(item?.question ?? "")).slice(0, 260),
    value: sanitizePathValue(item?.value),
    answerLabel: deidentify(String(item?.answerLabel ?? "")).slice(0, 260),
  })).filter((item) => item.question || item.answerLabel || item.answerKey);
}

function sanitizePathValue(value: unknown): string | number | string[] {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") return deidentify(value).slice(0, 240);
  if (Array.isArray(value)) {
    return value
      .filter((item) => typeof item === "string" || typeof item === "number")
      .map((item) => deidentify(String(item)).slice(0, 120))
      .slice(0, 20);
  }
  return "";
}

function cleanShort(value: unknown): string {
  return String(value ?? "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
}

function stringifyGuidedAnswers(answers: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(answers)) {
    const text = valueToText(value);
    if (text) out[key] = text;
  }
  return out;
}

function valueToText(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => String(item)).join(", ");
  if (value === null || value === undefined) return "";
  return String(value);
}

function guidedPrompt(answers: Record<string, unknown>, path: GuidedFlowPathItem[], language: "en" | "de"): string {
  const trail = path.map((item) => item.answerLabel || valueToText(item.value)).filter(Boolean).join(" -> ");
  const planning = answers.locationIntent === "planning_move";
  if (language === "de") {
    return [
      planning
        ? "Erstelle einen quellenbasierten Guide fuer eine Person, die den Umzug nach Deutschland plant."
        : "Erstelle einen quellenbasierten Guide fuer eine Person, die bereits in Deutschland ist.",
      trail ? `Bubble-Pfad: ${trail}.` : "",
      "Nenne passende Visa- oder Aufenthaltsschritte, benoetigte Unterlagen, Termine und offizielle Quellen.",
    ].filter(Boolean).join(" ");
  }
  return [
    planning
      ? "Create a source-grounded guide for a person currently planning to move to Germany."
      : "Create a source-grounded guide for a person already in Germany.",
    trail ? `Bubble path: ${trail}.` : "",
    "Include suitable visa or residence steps, documents, appointments, and official sources.",
  ].filter(Boolean).join(" ");
}

function guidedContext(answers: Record<string, unknown>, path: GuidedFlowPathItem[], language: "en" | "de"): string {
  const lines = path.map((item, index) => {
    const answer = item.answerLabel || valueToText(item.value);
    return `${index + 1}. ${item.question || item.answerKey}: ${answer}`;
  });
  const answerLines = Object.entries(answers).map(([key, value]) => `- ${key}: ${valueToText(value)}`);
  const heading = language === "de" ? "Gefuehrter Bubble-Kontext" : "Guided bubble context";
  return [heading, ...lines, "Raw categories:", ...answerLines].join("\n").slice(0, 2400);
}

function guidedTags(answers: Record<string, unknown>): string[] {
  const tags = new Set<string>();
  if (answers.locationIntent === "planning_move") tags.add("status:arriving");
  if (answers.journeyStage === "just_arrived") tags.add("status:arriving");
  const visa = String(answers.visaStatus ?? "");
  if (visa === "student") tags.add("status:student");
  if (["work", "skilled_work", "blue_card", "opportunity_card", "vocational_training"].includes(visa)) tags.add("status:worker");
  if (visa === "family") tags.add("status:family");
  if (visa === "asylum") tags.add("status:asylum");
  return Array.from(tags);
}

function sanitizeGuidedOptions(input: unknown, answers: Record<string, unknown>, language: "en" | "de"): GuidedFlowOption[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item: any) => ({
      value: cleanShort(item?.value),
      label: deidentify(String(item?.label ?? item?.value ?? "")).slice(0, 120),
      helper: deidentify(String(item?.helper ?? item?.description ?? "")).slice(0, 240),
      icon: cleanShort(item?.icon || "Sparkles"),
      badge: deidentify(String(item?.badge ?? "")).slice(0, 80),
      next: cleanShort(item?.next || defaultNextForOption(item?.value)),
      set: item?.set && typeof item.set === "object" && !Array.isArray(item.set) ? sanitizeGuidedAnswers(item.set) : undefined,
      source: deidentify(String(item?.source ?? "")).slice(0, 160),
    }))
    .filter((item) => item.value && item.label)
    .filter((item) => guidedOptionAllowed(item.value, answers))
    .slice(0, 9)
    .map((item) => ({
      ...item,
      badge: item.badge || (language === "de" ? "AI-geprueft" : "AI checked"),
    }));
}

function guidedOptionAllowed(value: string, answers: Record<string, unknown>): boolean {
  const age = Number(answers.age);
  if (!Number.isFinite(age) || age >= 18) return true;
  return ![
    "student",
    "vocational_training",
    "skilled_work",
    "blue_card",
    "opportunity_card",
    "self_employment",
    "job_offer",
    "university_admission",
    "training_contract",
    "employment_contract",
    "qualification_proof",
  ].includes(value);
}

function defaultNextForOption(value: unknown): string {
  const v = String(value ?? "");
  if (v.includes("document")) return "ai-result";
  return "";
}

function fallbackGuidedOptions(nodeId: string, answers: Record<string, unknown>, language: "en" | "de"): GuidedFlowOption[] {
  const de = language === "de";
  const age = Number(answers.age);
  const minor = Number.isFinite(age) && age < 18;
  const label = (en: string, german: string) => (de ? german : en);
  const checked = label("AI safety fallback", "AI-Sicherheitsfallback");

  const options: Record<string, GuidedFlowOption[]> = {
    "planning-visa": minor
      ? [
          { value: "family", label: label("Family reunification for a child", "Familiennachzug fuer ein Kind"), helper: label("For minors joining parents or guardians in Germany.", "Fuer Minderjaehrige, die zu Eltern oder Sorgeberechtigten ziehen."), icon: "Users", next: "planning-readiness", badge: checked },
          { value: "school", label: label("School or supervised stay", "Schule oder betreuter Aufenthalt"), helper: label("Requires guardian and school/program context.", "Braucht Sorgeberechtigte und Schul-/Programmkontext."), icon: "GraduationCap", next: "planning-readiness", badge: checked },
          { value: "asylum", label: label("Protection or asylum", "Schutz oder Asyl"), helper: label("Sensitive route; human counseling is recommended.", "Sensibler Weg; Beratung ist empfohlen."), icon: "ShieldCheck", next: "planning-readiness", badge: checked },
          { value: "counselor", label: label("Talk to a counselor first", "Erst mit Beratung sprechen"), helper: label("For a child or unclear case, get human support first.", "Bei Kindern oder unklarer Lage zuerst menschliche Hilfe holen."), icon: "Lightbulb", next: "planning-readiness", badge: checked },
        ]
      : [
          { value: "student", label: label("Student visa", "Studentenvisum"), helper: label("For higher education study or prep.", "Fuer Hochschulstudium oder Vorbereitung."), icon: "GraduationCap", next: "planning-readiness", badge: checked },
          { value: "vocational_training", label: label("Vocational training visa", "Visum zur Ausbildung"), helper: label("For Ausbildung or training contracts.", "Fuer Ausbildung oder Ausbildungsvertrag."), icon: "BriefcaseBusiness", next: "planning-readiness", badge: checked },
          { value: "skilled_work", label: label("Skilled worker visa", "Fachkraeftevisum"), helper: label("For recognized qualifications and a qualified job.", "Fuer anerkannte Qualifikation und qualifizierte Arbeit."), icon: "BadgeCheck", next: "planning-readiness", badge: checked },
          { value: "blue_card", label: label("EU Blue Card", "Blaue Karte EU"), helper: label("For qualified employment with salary requirements.", "Fuer qualifizierte Beschaeftigung mit Gehaltsanforderungen."), icon: "Sparkles", next: "planning-readiness", badge: checked },
          { value: "opportunity_card", label: label("Opportunity Card", "Chancenkarte"), helper: label("For job search if criteria are met.", "Zur Jobsuche, wenn Kriterien erfuellt sind."), icon: "Search", next: "planning-readiness", badge: checked },
          { value: "family", label: label("Family reunification", "Familiennachzug"), helper: label("For joining close family in Germany.", "Zum Nachzug zu enger Familie in Deutschland."), icon: "Users", next: "planning-readiness", badge: checked },
        ],
    "planning-readiness": minor
      ? [
          { value: "family_invitation", label: label("Family in Germany", "Familie in Deutschland"), helper: label("A parent or guardian is already in Germany.", "Ein Elternteil oder Vormund ist in Deutschland."), next: "planning-documents", badge: checked },
          { value: "school_acceptance", label: label("School/program acceptance", "Schul-/Programmzusage"), helper: label("A school, exchange, or supervised program is involved.", "Eine Schule, ein Austausch oder betreutes Programm ist beteiligt."), next: "planning-documents", badge: checked },
          { value: "guardian_support", label: label("Guardian support", "Unterstuetzung durch Sorgeberechtigte"), helper: label("A legal guardian can support the application.", "Ein gesetzlicher Vormund kann unterstuetzen."), next: "planning-documents", badge: checked },
          { value: "still_exploring", label: label("Still exploring", "Noch am Vergleichen"), helper: label("You need to compare safe routes first.", "Du musst sichere Wege zuerst vergleichen."), next: "planning-documents", badge: checked },
        ]
      : [],
  };

  return (options[nodeId] ?? []).filter((option) => guidedOptionAllowed(option.value, answers));
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
