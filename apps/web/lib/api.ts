import type { Wallet, AnswerResult } from "@/lib/types";
import { answerLocally } from "@/lib/engine";
import { deriveTags, deidentify, kAnonymityGuard } from "@/lib/privacy";

const API = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";

/**
 * Ask a free-form question.
 *
 * Privacy by construction: we de-identify on-device and only send the cleaned
 * query plus opaque tags. If the AI backend is unreachable, we answer locally
 * so the demo keeps working.
 */
export async function ask(rawQuery: string, w: Wallet): Promise<AnswerResult> {
  const cleaned = deidentify(rawQuery);
  const tags = kAnonymityGuard(deriveTags(w));

  if (!API) return answerLocally(rawQuery, w);

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(`${API}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // NOTE: only the cleaned query + opaque tags. No wallet, no identity.
      body: JSON.stringify({ query: cleaned, tags, region: w.region, language: w.language }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    return {
      answer: data.answer,
      cards: data.cards ?? [],
      sources: data.sources ?? [],
      confidence: data.confidence ?? 0.7,
      deidentifiedQuery: data.deidentifiedQuery ?? cleaned,
      sentTags: tags,
      escalate: data.escalate ?? false,
      origin: "server",
    };
  } catch {
    // Backend down or slow — fall back to the local engine.
    const local = answerLocally(rawQuery, w);
    return { ...local, origin: "device" };
  }
}

export function apiConfigured(): boolean {
  return Boolean(API);
}
