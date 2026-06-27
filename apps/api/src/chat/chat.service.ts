import { Injectable } from "@nestjs/common";
import { KnowledgeService, Doc } from "../knowledge/knowledge.service";
import { LlmService } from "../llm/llm.service";
import { deidentify, sanitizeTags } from "../common/deidentify";

export interface ChatRequest {
  query: string;
  tags?: string[];
  region?: string;
  language?: string;
}

export interface Source {
  title: string;
  origin: string;
  updatedAt: string;
}

export interface ChatResponse {
  answer: string;
  cards: { kind: string; title: string; body?: string; meta?: string }[];
  sources: Source[];
  confidence: number;
  escalate: boolean;
  deidentifiedQuery: string;
  provider: string;
}

const ESCALATE_RE = /lawyer|deport|abschieb|denied|rejected|suicide|hurt myself|emergency|police|violence/i;

@Injectable()
export class ChatService {
  constructor(
    private readonly knowledge: KnowledgeService,
    private readonly llm: LlmService,
  ) {}

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const query = deidentify(req.query ?? "");
    const tags = sanitizeTags(req.tags);
    const escalate = ESCALATE_RE.test(req.query ?? "");

    const docs = await this.knowledge.retrieve(query, tags, 3);
    const sources: Source[] = docs.map((d) => ({ title: d.title, origin: d.origin, updatedAt: d.updatedAt }));

    if (!docs.length) {
      return {
        answer: "I couldn't find a confident answer in the official sources. A human counselor can help with this.",
        cards: [{ kind: "escalate", title: "Talk to a counselor", body: "Free and confidential." }],
        sources: [],
        confidence: 0.2,
        escalate: true,
        deidentifiedQuery: query,
        provider: this.llm.provider,
      };
    }

    const composed = await this.llm.compose(this.systemPrompt(), this.userPrompt(query, tags, docs));

    if (composed && composed.answer) {
      const cards = composed.cards.length ? composed.cards : this.fallbackCards(escalate);
      return {
        answer: composed.answer,
        cards,
        sources,
        confidence: clamp(escalate ? Math.min(composed.confidence, 0.6) : composed.confidence),
        escalate: composed.escalate || escalate,
        deidentifiedQuery: query,
        provider: this.llm.provider,
      };
    }

    // Grounded fallback (mock provider or LLM failure): never invent, just
    // surface the best source verbatim-ish with action cards.
    const top = docs[0];
    return {
      answer: firstSentences(top.text, 2),
      cards: this.fallbackCards(escalate),
      sources,
      confidence: clamp((top.score ?? 2) >= 4 ? 0.78 : 0.62) * (escalate ? 0.8 : 1),
      escalate,
      deidentifiedQuery: query,
      provider: "mock",
    };
  }

  private systemPrompt(): string {
    return [
      "You are Wegweiser, a migration guidance assistant for newcomers in Germany, built on Integreat's content.",
      "Answer ONLY from the provided sources. If the sources do not answer the question, say so and recommend a human counselor.",
      "Be brief: 2-3 sentences maximum, plain language, no jargon.",
      "Never ask for or use personal data. Never invent facts, offices, dates, or amounts.",
      "Respond as strict JSON: {\"answer\": string, \"cards\": [{\"kind\": \"explain|office|appointment|upload|deadline|escalate|checklist|link\", \"title\": string, \"body\"?: string, \"meta\"?: string}], \"confidence\": number(0..1), \"escalate\": boolean}.",
      "Set escalate=true for legal, medical, or distressing situations.",
    ].join("\n");
  }

  private userPrompt(query: string, tags: string[], docs: Doc[]): string {
    const ctx = docs
      .map((d, i) => `[${i + 1}] ${d.title} (${d.origin}, updated ${d.updatedAt})\n${d.text}`)
      .join("\n\n");
    return `User question (already de-identified): ${query}\nUser context tags: ${tags.join(", ") || "none"}\n\nSources:\n${ctx}`;
  }

  private fallbackCards(escalate: boolean): { kind: string; title: string; body?: string; meta?: string }[] {
    const cards: { kind: string; title: string; body?: string; meta?: string }[] = [
      { kind: "explain", title: "Show me the steps" },
      { kind: "office", title: "Find the office near me" },
    ];
    if (escalate) cards.push({ kind: "escalate", title: "Talk to a counselor", body: "A person can help with this." });
    return cards;
  }
}

function clamp(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function firstSentences(text: string, n: number): string {
  const parts = text.split(/(?<=[.!?])\s+/);
  return parts.slice(0, n).join(" ");
}
