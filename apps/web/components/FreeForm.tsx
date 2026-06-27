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
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [actionNote, setActionNote] = useState<string | null>(null);

  async function run(q: string) {
    if (!q.trim()) return;
    setLoading(true);
    setActionNote(null);
    setResult(null);
    const r = await ask(q, wallet);
    setResult(r);
    setLoading(false);
  }

  function onAction(card: ActionCard) {
    if (card.kind === "escalate") {
      setActionNote("🤝 Connecting you to free, confidential counseling. A counselor sees only what you choose to share.");
      return;
    }
    setActionNote(`Opening: ${card.title}`);
  }

  return (
    <div className="mx-auto max-w-md px-5 pb-28 pt-4">
      <div className="card px-4 py-4">
        <h2 className="font-display text-[20px] font-bold text-ink">{t(lang, "free")}</h2>
        <p className="mt-1 text-[13px] text-muted">
          Ask in your own words. You get clear steps — not a wall of text — and you can always see what leaves your device.
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
              <button
                key={s}
                onClick={() => {
                  setQuery(s);
                  run(s);
                }}
                className="chip px-3 py-1.5 text-[13px]"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {loading && (
        <div className="card mt-3 flex items-center gap-3 px-4 py-4 text-[14px] text-muted">
          <Spinner /> Finding the most current official answer…
        </div>
      )}

      {result && (
        <div className="card mt-3 px-4 py-4">
          <AnswerView result={result} lang={lang} onAction={onAction} />
        </div>
      )}

      {actionNote && (
        <div className="card mt-3 px-4 py-3 text-[13px] text-ink animate-rise">{actionNote}</div>
      )}
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
