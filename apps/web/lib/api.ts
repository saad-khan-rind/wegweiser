import type { Wallet, AnswerResult, Source } from "@/lib/types";
import { answerLocally } from "@/lib/engine";
import { deriveTags, deidentify, kAnonymityGuard } from "@/lib/privacy";

/**
 * Resolve the API base URL at RUNTIME.
 *
 * A static export can't read server env at request time, so the URL is injected
 * by /config.js (written from $API_URL when the container starts). This means
 * you can change the backend address without rebuilding the frontend — the fix
 * for "the app can't reach the AI". Falls back to the build-time value.
 */
function apiBase(): string {
  if (typeof window !== "undefined") {
    const cfg = (window as any).__WEGWEISER_CONFIG__;
    if (cfg && cfg.apiUrl) return String(cfg.apiUrl).replace(/\/$/, "");
  }
  return (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");
}

// CPU LLM inference + the verification loop are slow. Don't abort early — that
// was the bug that made answers silently fall back to the on-device engine.
function timeoutMs(): number {
  if (typeof window !== "undefined") {
    const cfg = (window as any).__WEGWEISER_CONFIG__;
    if (cfg && cfg.timeoutMs) return Number(cfg.timeoutMs);
  }
  return 200000;
}

export async function ask(rawQuery: string, w: Wallet, extraContext = ""): Promise<AnswerResult> {
  const cleaned = deidentify(rawQuery);
  const tags = kAnonymityGuard(deriveTags(w));
  const API = apiBase();

  if (!API) return answerLocally(rawQuery, w);

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs());
    const res = await fetch(`${API}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Only the cleaned query + opaque tags ever leave the device.
      body: JSON.stringify({
        query: cleaned,
        tags,
        region: w.region,
        language: w.language,
        extraContext,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    const sources: Source[] = (data.sources ?? []).map((s: any) => ({
      title: s.title,
      origin: s.origin ?? "source",
      updatedAt: s.updatedAt ?? s.date ?? "",
      href: s.url || s.href || undefined,
    }));
    return {
      answer: data.answer ?? "",
      cards: data.cards ?? [],
      sources,
      confidence: data.confidence ?? 0.7,
      deidentifiedQuery: data.deidentifiedQuery ?? cleaned,
      sentTags: tags,
      escalate: data.escalate ?? false,
      origin: "server",
      clarifyingQuestion: data.clarifyingQuestion || undefined,
      needsInput: Boolean(data.needsInput),
      trace: Array.isArray(data.trace) ? data.trace : undefined,
    };
  } catch {
    // Backend down or aborted — keep the demo alive with the on-device engine.
    const local = answerLocally(rawQuery, w);
    return { ...local, origin: "device" };
  }
}

export function apiConfigured(): boolean {
  return Boolean(apiBase());
}

// ---- Admin: document ingestion ------------------------------------------
export interface IngestMeta {
  title: string;
  source?: string;
  url?: string;
  date?: string;
}

function adminHeaders(token: string): Record<string, string> {
  return token ? { "x-admin-token": token } : {};
}

export async function ingestText(meta: IngestMeta & { text: string }, token: string) {
  const res = await fetch(`${apiBase()}/api/admin/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...adminHeaders(token) },
    body: JSON.stringify(meta),
  });
  if (!res.ok) throw new Error(`Ingest failed (${res.status})`);
  return res.json();
}

export async function ingestFile(file: File, meta: IngestMeta, token: string) {
  const form = new FormData();
  form.append("file", file);
  form.append("title", meta.title || file.name);
  form.append("source", meta.source || "admin upload");
  form.append("url", meta.url || "");
  form.append("date", meta.date || "");
  const res = await fetch(`${apiBase()}/api/admin/ingest-file`, {
    method: "POST",
    headers: { ...adminHeaders(token) },
    body: form,
  });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
  return res.json();
}

export async function listDocuments(token: string) {
  const res = await fetch(`${apiBase()}/api/admin/documents`, { headers: { ...adminHeaders(token) } });
  if (!res.ok) throw new Error(`List failed (${res.status})`);
  return res.json();
}

export async function refreshCrawl(region: string, lang: string, token: string) {
  const res = await fetch(`${apiBase()}/api/admin/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...adminHeaders(token) },
    body: JSON.stringify({ region, lang }),
  });
  if (!res.ok) throw new Error(`Refresh failed (${res.status})`);
  return res.json();
}
