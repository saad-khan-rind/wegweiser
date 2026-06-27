import { Injectable, Logger } from "@nestjs/common";

export interface LlmJson {
  answer: string;
  cards: { kind: string; title: string; body?: string; meta?: string }[];
  confidence: number;
  escalate: boolean;
}

/**
 * One interface, several backends. Order of preference:
 *   1. Ollama (open weights, self-hostable)
 *   2. null -> caller refuses or composes only from sources
 *
 * Gemini is handled by the Python AI service through apps/ai/.env.
 */
@Injectable()
export class LlmService {
  private readonly log = new Logger("LlmService");

  get provider(): "ollama" | "mock" {
    if (process.env.OLLAMA_URL) return "ollama";
    return "mock";
  }

  async compose(system: string, user: string): Promise<LlmJson | null> {
    try {
      switch (this.provider) {
        case "ollama":
          return this.parse(await this.ollama(system, user));
        default:
          return null;
      }
    } catch (e) {
      this.log.warn(`LLM compose failed (${this.provider}): ${(e as Error).message}`);
      return null;
    }
  }

  private parse(raw: string): LlmJson | null {
    if (!raw) return null;
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1) return null;
    try {
      const obj = JSON.parse(cleaned.slice(start, end + 1));
      return {
        answer: String(obj.answer ?? ""),
        cards: Array.isArray(obj.cards) ? obj.cards : [],
        confidence: typeof obj.confidence === "number" ? obj.confidence : 0.7,
        escalate: Boolean(obj.escalate),
      };
    } catch {
      return null;
    }
  }

  private async ollama(system: string, user: string): Promise<string> {
    const url = process.env.OLLAMA_URL!.replace(/\/$/, "");
    const res = await fetch(`${url}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OLLAMA_MODEL ?? "llama3.1:8b",
        stream: false,
        format: "json",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    const data = await res.json();
    return data?.message?.content ?? "";
  }

}
