"use client";
import { useState } from "react";
import type { Wallet, LangCode, AnswerResult, ActionCard } from "@/lib/types";
import { ask } from "@/lib/api";
import { t } from "@/lib/i18n";
import AnswerView from "./AnswerView";

const SUGGESTIONS = [
  "How do I register my address?",
  "Can I work yet?",
  "Where do I learn German?",
  "How do I get child benefit?",
];

export default function FreeForm({ wallet, lang }: { wallet: Wallet; lang: LangCode }) {
  const [query, setQuery] = useState("");
  const [lastQuery, setLastQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [actionNote, setActionNote] = useState<string | null>(null);
  const [clarifyAnswer, setClarifyAnswer] = useState("");

  async function run(q: string, extraContext = "") {
    if (!q.trim()) return;
    setLoading(true);
    setActionNote(null);
    setResult(null);
    if (!extraContext) setLastQuery(q);
    const r = await ask(q, wallet, extraContext);
    setResult(r);
    setClarifyAnswer("");
    setLoading(false);
  }

  function onAction(card: ActionCard) {
    if (card.kind === "escalate") {
      setActionNote("🤝 Connecting you to free, confidential counseling. A counselor sees only what you choose to share.");
      return;
    }
    setActionNote(`Opening: ${card.title}`);
  }

  const clarifying = result?.needsInput && result?.clarifyingQuestion;

  return (
    <div className="mx-auto max-w-md px-5 pb-28 pt-4">
      <div className="card px-4 py-4">
        <h2 className="font-display text-[20px] font-bold text-ink">{t(lang, "free")}</h2>
        <p className="mt-1 text-[13px] text-muted">
          Ask in your own words. The assistant checks official sources, verifies its own answer, and asks you
          before assuming anything.
        </p>

        <div className="mt-3 flex items-end gap-2">
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                run(query);
              }
            }}
            rows={1}
            placeholder={t(lang, "askPlaceholder")}
            className="min-h-[44px] flex-1 resize-none rounded-xl border border-line bg-paper px-3 py-2.5 text-[15px] text-ink outline-none focus:border-ink"
          />
          <button
            onClick={() => run(query)}
            disabled={loading || !query.trim()}
            className="btn btn-primary grid h-11 w-11 shrink-0 place-items-center disabled:opacity-40"
            aria-label="Ask"
          >
            {loading ? <Spinner /> : "→"}
          </button>
        </div>

        {!result && !loading && (
          <div className="mt-3 flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => { setQuery(s); run(s); }} className="chip px-3 py-1.5 text-[13px]">
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {loading && (
        <div className="card mt-3 flex items-center gap-3 px-4 py-4 text-[14px] text-muted">
          <Spinner /> Checking official sources and verifying the answer…
        </div>
      )}

      {/* Clarifying question — the assistant asks instead of assuming */}
      {clarifying && (
        <div
          className="card mt-3 px-4 py-4 animate-rise"
          style={{ boxShadow: "0 0 0 2px var(--amber), 0 10px 30px -22px rgba(22,36,59,.4)" }}
        >
          <div className="mb-1 flex items-center gap-2 font-mono text-[11px] uppercase tracking-wide" style={{ color: "var(--amber)" }}>
            <span>✋</span> One quick question
          </div>
          <p className="text-[15px] font-medium text-ink">{result!.clarifyingQuestion}</p>
          <div className="mt-3 flex items-end gap-2">
            <input
              value={clarifyAnswer}
              onChange={(e) => setClarifyAnswer(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") run(lastQuery, clarifyAnswer); }}
              placeholder="Your answer…"
              className="h-11 flex-1 rounded-xl border border-line bg-paper px-3 text-[15px] text-ink outline-none focus:border-ink"
            />
            <button
              onClick={() => run(lastQuery, clarifyAnswer)}
              disabled={!clarifyAnswer.trim()}
              className="btn btn-signal h-11 px-4 text-[14px] disabled:opacity-40"
            >
              Answer
            </button>
          </div>
          <p className="mt-2 text-[11px] text-muted">
            This stays on your device and is only used to refine this answer.
          </p>
        </div>
      )}

      {result && !clarifying && (
        <div className="card mt-3 px-4 py-4">
          <AnswerView result={result} lang={lang} onAction={onAction} />
        </div>
      )}

      {actionNote && <div className="card mt-3 px-4 py-3 text-[13px] text-ink animate-rise">{actionNote}</div>}
    </div>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
