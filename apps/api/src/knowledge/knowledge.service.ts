import { Injectable } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";

export interface Doc {
  id: string;
  title: string;
  origin: string;
  updatedAt: string;
  tags: string[];
  text: string;
  score?: number;
}

const STOP = new Set([
  "the", "a", "an", "to", "of", "in", "on", "for", "and", "or", "is", "are",
  "i", "my", "me", "do", "how", "what", "can", "where", "when", "with", "you",
]);

@Injectable()
export class KnowledgeService {
  private docs: Doc[] = [];

  constructor() {
    const file = path.join(__dirname, "kb.json");
    try {
      this.docs = JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch {
      // When running from ts-node the json sits next to the source file.
      const alt = path.join(process.cwd(), "src/knowledge/kb.json");
      this.docs = JSON.parse(fs.readFileSync(alt, "utf-8"));
    }
  }

  /** Retrieve top-k docs. Uses the Python RAG service if AI_SERVICE_URL is set. */
  async retrieve(query: string, tags: string[], k = 3): Promise<Doc[]> {
    const ai = process.env.AI_SERVICE_URL?.replace(/\/$/, "");
    if (ai) {
      try {
        const res = await fetch(`${ai}/retrieve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, tags, k }),
        });
        if (res.ok) {
          const data = (await res.json()) as { documents: Doc[] };
          if (data.documents?.length) return data.documents;
        }
      } catch {
        // fall through to local retrieval
      }
    }
    return this.localRetrieve(query, tags, k);
  }

  get(id: string): Doc | null {
    return this.docs.find((d) => d.id === id) ?? null;
  }

  private localRetrieve(query: string, tags: string[], k: number): Doc[] {
    const terms = this.tokenize(query);
    const scored = this.docs.map((d) => {
      const hay = `${d.title} ${d.text}`.toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (hay.includes(t)) score += 2;
      }
      // tag boosts: matching family/status tags lift relevant docs
      for (const tag of tags) {
        if (d.tags.includes(tag)) score += 1.5;
      }
      return { ...d, score };
    });
    return scored
      .filter((d) => (d.score ?? 0) > 0)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, k);
  }

  private tokenize(q: string): string[] {
    return q
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w));
  }
}
