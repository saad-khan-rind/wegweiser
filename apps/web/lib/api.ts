import type { Wallet, AnswerResult, Source } from "@/lib/types";
import { deriveTags, deidentify, kAnonymityGuard } from "@/lib/privacy";
import { t } from "@/lib/i18n";

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

// CPU LLM inference + the verification loop are slow. Don't abort early.
function timeoutMs(): number {
  if (typeof window !== "undefined") {
    const cfg = (window as any).__WEGWEISER_CONFIG__;
    if (cfg && cfg.timeoutMs) return Number(cfg.timeoutMs);
  }
  return 200000;
}

export async function ask(rawQuery: string, w: Wallet, extraContext = "", clarifyingAnswers: Record<string, string> = {}): Promise<AnswerResult> {
  const cleaned = deidentify(rawQuery);
  const cleanedExtra = deidentify(extraContext);
  const tags = kAnonymityGuard(deriveTags(w));
  const API = apiBase();

  if (!API) return unavailableAnswer(cleaned, tags, w.language);

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
        extraContext: cleanedExtra,
        clarifyingAnswers,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    const API_BASE = apiBase();
    const sources: Source[] = (data.sources ?? []).map((s: any) => ({
      id: s.id || undefined,
      title: s.title,
      origin: s.origin ?? "source",
      updatedAt: s.updatedAt ?? s.date ?? "",
      href: sourceHref(s.url || s.href || "", API_BASE),
      relevance: s.relevance,
      accepted: s.accepted,
      excerpt: s.excerpt,
    }));
    const resourcesConsidered: Source[] = (data.resourcesConsidered ?? []).map((s: any) => ({
      id: s.id || undefined,
      title: s.title,
      origin: s.origin ?? "source",
      updatedAt: s.updatedAt ?? s.date ?? "",
      href: sourceHref(s.url || s.href || "", API_BASE),
      relevance: s.relevance,
      accepted: s.accepted,
      excerpt: s.excerpt,
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
      provider: data.provider,
      model: data.model,
      clarifyingQuestion: data.clarifyingQuestion || undefined,
      clarifyingQuestions: Array.isArray(data.clarifyingQuestions) ? data.clarifyingQuestions : undefined,
      needsInput: Boolean(data.needsInput),
      trace: Array.isArray(data.trace) ? data.trace : undefined,
      resourcesConsidered,
    };
  } catch {
    return unavailableAnswer(cleaned, tags, w.language);
  }
}

export function apiConfigured(): boolean {
  return Boolean(apiBase());
}

export async function getHealth() {
  const API = apiBase();
  if (!API) throw new Error("API URL is not configured");
  const res = await fetch(`${API}/api/health`);
  if (!res.ok) throw new Error(`Health check failed (${res.status})`);
  return res.json();
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

export async function clearDocuments(token: string) {
  const res = await fetch(`${apiBase()}/api/admin/documents`, {
    method: "DELETE",
    headers: { ...adminHeaders(token) },
  });
  if (!res.ok) throw new Error(`Clear failed (${res.status})`);
  return res.json();
}

export async function refreshCrawl(region: string, lang: string, token: string, url = "") {
  const res = await fetch(`${apiBase()}/api/admin/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...adminHeaders(token) },
    body: JSON.stringify({ region, lang, url }),
  });
  if (!res.ok) throw new Error(`Refresh failed (${res.status})`);
  return res.json();
}

function sourceHref(url: string, api: string): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("/api/")) return `${api}${url}`;
  return url;
}

function unavailableAnswer(cleaned: string, tags: string[], lang: Wallet["language"]): AnswerResult {
  const isDe = lang === "de";
  return {
    answer: isDe
      ? "Ich kann gerade keine verifizierte Antwort aus den offiziellen Quellen erstellen. Bitte versuche es später erneut oder wende dich an eine Beratungsperson."
      : "I can't create a verified answer from official sources right now. Please try again later or ask a counselor.",
    cards: [{ kind: "escalate", title: t(lang, "talkHuman"), body: isDe ? "Kostenlos und vertraulich." : "Free and confidential." }],
    sources: [],
    confidence: 0.1,
    deidentifiedQuery: cleaned,
    sentTags: tags,
    escalate: true,
    origin: "device",
  };
}
