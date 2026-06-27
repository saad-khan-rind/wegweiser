"use client";
import type { AnswerResult, ActionCard, Source, LangCode } from "@/lib/types";
import { t } from "@/lib/i18n";
import PrivacyReceipt from "./PrivacyReceipt";

const KIND_META: Record<string, { glyph: string; tint: string }> = {
  explain: { glyph: "💡", tint: "var(--teal)" },
  office: { glyph: "📍", tint: "var(--ink)" },
  appointment: { glyph: "🗓️", tint: "var(--ink)" },
  upload: { glyph: "📎", tint: "var(--ink)" },
  deadline: { glyph: "⏰", tint: "var(--amber)" },
  escalate: { glyph: "🤝", tint: "var(--rose)" },
  checklist: { glyph: "✓", tint: "var(--signal)" },
  link: { glyph: "↗", tint: "var(--ink)" },
};

export default function AnswerView({
  result,
  lang,
  onAction,
}: {
  result: AnswerResult;
  lang: LangCode;
  onAction?: (card: ActionCard) => void;
}) {
  return (
    <div className="animate-rise">
      {result.escalate && <EscalateBanner lang={lang} />}

      <p className="text-[15px] leading-relaxed text-ink">{result.answer}</p>

      <div className="mt-3 grid gap-2">
        {result.cards.map((card, i) => (
          <ActionCardRow key={i} card={card} onAction={onAction} />
        ))}
      </div>

      <ConfidenceRow confidence={result.confidence} lang={lang} />
      {result.sources.length > 0 && <SourceList sources={result.sources} lang={lang} />}
      <PrivacyReceipt result={result} lang={lang} />
    </div>
  );
}

function ActionCardRow({ card, onAction }: { card: ActionCard; onAction?: (c: ActionCard) => void }) {
  const meta = KIND_META[card.kind] ?? KIND_META.link;
  return (
    <button
      onClick={() => onAction?.(card)}
      className="card flex items-start gap-3 px-3 py-3 text-left transition hover:-translate-y-[1px]"
    >
      <span
        className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[15px]"
        style={{ background: "color-mix(in srgb, var(--paper) 70%, white)", boxShadow: `inset 0 0 0 1.5px ${meta.tint}22` }}
      >
        {meta.glyph}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="font-display text-[14px] font-semibold text-ink">{card.title}</span>
          {card.meta && <span className="shrink-0 font-mono text-[11px] text-muted">{card.meta}</span>}
        </span>
        {card.body && <span className="mt-0.5 block text-[13px] leading-snug text-muted">{card.body}</span>}
      </span>
    </button>
  );
}

function ConfidenceRow({ confidence, lang }: { confidence: number; lang: LangCode }) {
  const pct = Math.round(confidence * 100);
  const tone = confidence >= 0.85 ? "var(--signal)" : confidence >= 0.6 ? "var(--amber)" : "var(--rose)";
  const label = confidence >= 0.85 ? "High" : confidence >= 0.6 ? "Medium" : "Low";
  return (
    <div className="mt-3 flex items-center gap-3">
      <span className="text-[11px] uppercase tracking-wide text-muted">{t(lang, "confidence")}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink/[0.06]">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: tone }} />
      </div>
      <span className="font-mono text-[12px]" style={{ color: tone }}>
        {label} · {pct}%
      </span>
    </div>
  );
}

function SourceList({ sources, lang }: { sources: Source[]; lang: LangCode }) {
  return (
    <div className="mt-3">
      <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">{t(lang, "sources")}</div>
      <ul className="space-y-1">
        {sources.map((s, i) => (
          <li key={i} className="flex items-center justify-between gap-2 text-[13px]">
            <span className="flex items-center gap-2 text-ink">
              <span
                className="rounded px-1.5 py-0.5 font-mono text-[10px] uppercase"
                style={{ background: "var(--ink)", color: "var(--paper)" }}
              >
                {s.origin}
              </span>
              {s.title}
            </span>
            <span className="shrink-0 font-mono text-[11px] text-muted">
              {t(lang, "updated")} {fmt(s.updatedAt)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EscalateBanner({ lang }: { lang: LangCode }) {
  return (
    <div
      className="mb-3 flex items-center gap-3 rounded-xl px-3 py-2.5"
      style={{ background: "color-mix(in srgb, var(--rose) 12%, white)", border: "1.5px solid color-mix(in srgb, var(--rose) 40%, white)" }}
    >
      <span className="text-lg">🤝</span>
      <p className="text-[13px] leading-snug text-ink">
        This looks like it needs a person. A counselor can take it from here, with an interpreter if you need one.
      </p>
    </div>
  );
}

function fmt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
