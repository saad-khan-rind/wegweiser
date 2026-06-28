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
      {(result.provider || result.model) && (
        <div className="mb-2 inline-flex rounded-full border border-line bg-paper px-2.5 py-1 font-mono text-[11px] text-muted">
          AI: {result.provider || "unknown"}{result.model ? ` / ${result.model}` : ""}
        </div>
      )}

      <p className="text-[15px] leading-relaxed text-ink">{result.answer}</p>

      <div className="mt-3 grid gap-2">
        {result.cards.map((card, i) => (
          <ActionCardRow key={i} card={card} onAction={onAction} />
        ))}
      </div>

      <ConfidenceRow confidence={result.confidence} lang={lang} />
      {result.sources.length > 0 && <SourceList sources={result.sources} lang={lang} />}
      {result.resourcesConsidered && result.resourcesConsidered.length > 0 && (
        <ResourceList resources={result.resourcesConsidered} />
      )}
      <PrivacyReceipt result={result} lang={lang} />
      {result.trace && result.trace.length > 0 && <VerifyTrace trace={result.trace} />}
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
      <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">Used sources</div>
      <ul className="space-y-1">
        {sources.map((s, i) => (
          <li key={i} className="flex items-center justify-between gap-2 text-[13px]">
            <span className="flex min-w-0 items-center gap-2 text-ink">
              <span
                className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase"
                style={{ background: "var(--ink)", color: "var(--paper)" }}
              >
                {s.origin}
              </span>
              {s.href ? (
                <a href={s.href} target="_blank" rel="noopener noreferrer" className="truncate underline decoration-dotted underline-offset-2 hover:decoration-solid">
                  {s.title}
                </a>
              ) : (
                <span className="truncate">{s.title}</span>
              )}
            </span>
            {s.updatedAt && (
              <span className="shrink-0 font-mono text-[11px] text-muted">
                {t(lang, "updated")} {fmt(s.updatedAt)}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ResourceList({ resources }: { resources: Source[] }) {
  return (
    <details className="mt-3 rounded-xl border border-line bg-paper/60">
      <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-muted">
        Resources considered ({resources.length})
      </summary>
      <ul className="space-y-2 border-t border-line px-3 py-3">
        {resources.map((s, i) => (
          <li key={`${s.id || s.title}-${i}`} className="text-[12px] leading-snug text-ink">
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase"
                  style={{ background: s.accepted ? "var(--ink)" : "var(--line)", color: s.accepted ? "var(--paper)" : "var(--muted)" }}
                >
                  {s.accepted ? "kept" : "rejected"}
                </span>
                {s.href ? (
                  <a href={s.href} target="_blank" rel="noopener noreferrer" className="truncate underline decoration-dotted underline-offset-2">
                    {s.title}
                  </a>
                ) : (
                  <span className="truncate">{s.title}</span>
                )}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-muted">
                relevance {s.relevance ?? 0}
              </span>
            </div>
            {s.excerpt && <p className="mt-1 line-clamp-2 text-muted">{s.excerpt}</p>}
          </li>
        ))}
      </ul>
    </details>
  );
}

function VerifyTrace({ trace }: { trace: string[] }) {
  return (
    <details className="mt-3 rounded-xl border border-line bg-paper/60">
      <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-muted">
        🔎 How I checked this ({trace.length} steps)
      </summary>
      <ol className="space-y-1 border-t border-line px-4 py-3">
        {trace.map((step, i) => (
          <li key={i} className="flex gap-2 text-[12px] leading-snug text-ink">
            <span className="font-mono text-muted">{i + 1}.</span>
            {step}
          </li>
        ))}
      </ol>
    </details>
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
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
