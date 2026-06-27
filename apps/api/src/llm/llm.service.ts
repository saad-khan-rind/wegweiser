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
 *   2. OpenAI / Anthropic (if a key is provided for the API fallback)
 *   3. null -> caller refuses or composes only from sources
 */
@Injectable()
export class LlmService {
  private readonly log = new Logger("LlmService");

  get provider(): "ollama" | "openai" | "anthropic" | "mock" {
    if (process.env.OLLAMA_URL) return "ollama";
    if (process.env.OPENAI_API_KEY) return "openai";
    if (process.env.ANTHROPIC_API_KEY) return "anthropic";
    return "mock";
  }

  async compose(system: string, user: string): Promise<LlmJson | null> {
    try {
      switch (this.provider) {
        case "ollama":
          return this.parse(await this.ollama(system, user));
        case "openai":
          return this.parse(await this.openai(system, user));
        case "anthropic":
          return this.parse(await this.anthropic(system, user));
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

  private async openai(system: string, user: string): Promise<string> {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    const data = await res.json();
    return data?.choices?.[0]?.message?.content ?? "";
  }

  private async anthropic(system: string, user: string): Promise<string> {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL ?? "claude-3-5-sonnet-latest",
        max_tokens: 700,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    const data = await res.json();
    const block = Array.isArray(data?.content) ? data.content.find((c: any) => c.type === "text") : null;
    return block?.text ?? "";
  }
}
