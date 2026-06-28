"use client";
import { useEffect, useMemo, useState } from "react";
import { ask, apiConfigured, getHealth } from "@/lib/api";
import type { AnswerResult, LangCode, Wallet } from "@/lib/types";
import AnswerView from "@/components/AnswerView";

type Status = { kind: "idle" | "ok" | "err" | "busy"; msg: string };

export default function Page() {
  const [mounted, setMounted] = useState(false);
  const [language, setLanguage] = useState<LangCode>("en");
  const [region, setRegion] = useState("bavaria");
  const [query, setQuery] = useState("");
  const [lastQuery, setLastQuery] = useState("");
  const [extraContext, setExtraContext] = useState("");
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle", msg: "" });
  const [health, setHealth] = useState<any>(null);

  useEffect(() => setMounted(true), []);

  const wallet = useMemo<Wallet>(() => ({
    region,
    regionLabel: region,
    language,
    hasChildren: false,
    childrenCount: 0,
    hasPartner: false,
    flags: [],
    documents: [],
    completed: [],
    guest: true,
    createdAt: Date.now(),
  }), [language, region]);

  async function runAsk(extra = "") {
    if (!query.trim()) return;
    setLoading(true);
    setStatus({ kind: "busy", msg: "Checking sources and verifying the answer..." });
    setResult(null);
    if (!extra) setLastQuery(query);
    try {
      const r = await ask(extra ? lastQuery || query : query, wallet, extra);
      setResult(r);
      setStatus({ kind: "ok", msg: r.needsInput ? "The assistant needs one detail before answering." : "Answer generated from available sources." });
      setExtraContext("");
    } catch (e) {
      setStatus({ kind: "err", msg: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }

  async function checkHealth() {
    setStatus({ kind: "busy", msg: "Checking services..." });
    try {
      const r = await getHealth();
      setHealth(r);
      const store = r.ai?.pinecone?.backend || r.ai?.vector_store || "unknown";
      const provider = r.ai?.llm?.provider || "unknown";
      const model = r.ai?.llm?.chat_model || "unknown model";
      setStatus({ kind: "ok", msg: `AI ${r.ai?.ok ? "online" : "not ready"} · ${provider} / ${model} · ${store}` });
    } catch (e) {
      setStatus({ kind: "err", msg: (e as Error).message });
    }
  }

  if (!mounted) return <div className="min-h-[100dvh]" />;

  const clarifying = Boolean(result?.needsInput && result.clarifyingQuestion);

  return (
    <main className="min-h-[100dvh] px-5 py-6">
      <div className="mx-auto max-w-3xl">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted">Wegweiser</div>
            <h1 className="mt-1 font-display text-[28px] font-bold text-ink">AI test console</h1>
          </div>
          <div className="flex items-center gap-2">
            <a href={`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/admin/`} className="chip px-3 py-1.5 text-[13px]">Admin</a>
            <button onClick={checkHealth} className="chip px-3 py-1.5 text-[13px]">Health</button>
          </div>
        </header>

        <section className="card px-4 py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_160px]">
            <div>
              <label className="mb-1 block text-[12px] font-medium text-ink">Question</label>
              <textarea
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                rows={5}
                placeholder={language === "de" ? "Stelle eine Frage..." : "Ask a question..."}
                className="w-full resize-y rounded-xl border border-line bg-paper px-3 py-2.5 text-[15px] text-ink outline-none focus:border-ink"
              />
            </div>
            <div className="grid content-start gap-3">
              <Field label="Region" value={region} onChange={setRegion} />
              <div>
                <label className="mb-1 block text-[12px] font-medium text-ink">Language</label>
                <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-line bg-paper">
                  {(["en", "de"] as LangCode[]).map((l) => (
                    <button
                      key={l}
                      onClick={() => setLanguage(l)}
                      className="h-10 font-mono text-[13px] uppercase"
                      style={{ background: language === l ? "var(--ink)" : "transparent", color: language === l ? "var(--paper)" : "var(--muted)" }}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={() => runAsk()}
                disabled={loading || !query.trim()}
                className="btn btn-primary h-11 px-4 text-[14px] disabled:opacity-40"
              >
                {loading ? "Working..." : "Ask AI"}
              </button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-muted">
            <span className="rounded-full border border-line px-2 py-1">{apiConfigured() ? "API configured" : "API not configured"}</span>
            <span className="rounded-full border border-line px-2 py-1">Default language: English</span>
            <span className="rounded-full border border-line px-2 py-1">English/German only</span>
          </div>
        </section>

        {status.kind !== "idle" && (
          <div className="mt-4 rounded-xl border border-line bg-card px-4 py-3 text-[13px] text-ink">
            {status.msg}
          </div>
        )}

        {health && (
          <section className="card mt-4 px-4 py-4">
            <h2 className="font-display text-[18px] font-bold text-ink">System status</h2>
            <dl className="mt-3 grid grid-cols-1 gap-2 text-[13px] sm:grid-cols-3">
              <StatusItem label="AI" value={health.ai?.ok ? "online" : "not ready"} />
              <StatusItem label="LLM" value={health.ai?.llm?.provider || "unknown"} />
              <StatusItem label="Model" value={health.ai?.llm?.chat_model || "unknown"} />
              <StatusItem label="Vector store" value={health.ai?.pinecone?.backend || health.ai?.vector_store || "unknown"} />
              <StatusItem label="Pinecone" value={health.ai?.pinecone?.configured ? "configured" : "not configured"} />
              <StatusItem label="Embeddings" value={`${health.ai?.pinecone?.embedding_provider || "unknown"} (${health.ai?.pinecone?.embedding_dim || "?"})`} />
              <StatusItem label="Web verify" value={health.ai?.use_web ? "on" : "off"} />
            </dl>
          </section>
        )}

        {clarifying && (
          <section className="card mt-4 px-4 py-4">
            <div className="font-mono text-[11px] uppercase tracking-wide text-muted">Clarifying question</div>
            <p className="mt-1 text-[15px] font-medium text-ink">{result!.clarifyingQuestion}</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                value={extraContext}
                onChange={(e) => setExtraContext(e.target.value)}
                placeholder={language === "de" ? "Deine Antwort..." : "Your answer..."}
                className="h-11 flex-1 rounded-xl border border-line bg-paper px-3 text-[15px] text-ink outline-none focus:border-ink"
              />
              <button
                onClick={() => runAsk(extraContext)}
                disabled={!extraContext.trim()}
                className="btn btn-signal h-11 px-4 text-[14px] disabled:opacity-40"
              >
                Continue
              </button>
            </div>
          </section>
        )}

        {result && !clarifying && (
          <section className="card mt-4 px-4 py-4">
            <AnswerView result={result} lang={language} onAction={() => undefined} />
            {result.trace?.length ? (
              <details className="mt-4 rounded-xl border border-line bg-paper px-3 py-2 text-[12px] text-muted">
                <summary className="cursor-pointer text-ink">Verification trace</summary>
                <ul className="mt-2 space-y-1">
                  {result.trace.map((line, i) => <li key={i}>{line}</li>)}
                </ul>
              </details>
            ) : null}
          </section>
        )}
      </div>
    </main>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="mb-1 block text-[12px] font-medium text-ink">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full rounded-xl border border-line bg-paper px-3 text-[14px] text-ink outline-none focus:border-ink"
      />
    </div>
  );
}

function StatusItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-paper px-3 py-2">
      <dt className="font-mono text-[10px] uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 font-medium text-ink">{value}</dd>
    </div>
  );
}
