"use client";
import { useState } from "react";
import type { Station, LangCode, ActionCard, AnswerResult } from "@/lib/types";
import { explainStation } from "@/lib/engine";
import { t } from "@/lib/i18n";
import AnswerView from "./AnswerView";

export default function StationSheet({
  station,
  done,
  lang,
  onClose,
  onToggleDone,
}: {
  station: Station;
  done: boolean;
  lang: LangCode;
  onClose: () => void;
  onToggleDone: () => void;
}) {
  const [answer, setAnswer] = useState<AnswerResult | null>(null);
  const [actionNote, setActionNote] = useState<string | null>(null);

  function handleAction(card: ActionCard) {
    if (card.kind === "explain") {
      setAnswer(explainStation(station));
      return;
    }
    setActionNote(noteFor(card));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        className={`line-${station.line} relative max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-paper sm:rounded-2xl`}
        role="dialog"
        aria-modal="true"
      >
        {/* boarding-pass header */}
        <div className="sticky top-0 z-10" style={{ background: "var(--c)" }}>
          <div className="flex items-start gap-3 px-5 pb-4 pt-4 text-white">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-white/15 text-2xl">
              {station.icon}
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-mono text-[11px] uppercase tracking-wide text-white/75">Stop on your route</div>
              <h3 className="font-display text-[20px] font-bold leading-tight">{station.title}</h3>
            </div>
            <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full bg-white/15 text-white" aria-label={t(lang, "back")}>
              ✕
            </button>
          </div>
          {/* perforation */}
          <div className="flex items-center justify-between px-3 pb-2">
            {Array.from({ length: 18 }).map((_, i) => (
              <span key={i} className="h-1.5 w-1.5 rounded-full bg-paper" />
            ))}
          </div>
        </div>

        <div className="px-5 pb-8 pt-4">
          {/* meta row */}
          <div className="flex flex-wrap gap-2">
            {station.estMinutes > 0 && (
              <Meta label={t(lang, "estTime")} value={`≈ ${station.estMinutes} min`} />
            )}
            <Meta label={t(lang, "updated")} value={fmt(station.updatedAt)} />
          </div>

          <p className="mt-4 text-[15px] leading-relaxed text-ink">{station.summary}</p>

          {/* required documents */}
          {station.requiredDocs.length > 0 && (
            <section className="mt-5">
              <h4 className="mb-2 font-display text-[13px] font-semibold uppercase tracking-wide text-muted">
                {t(lang, "required")}
              </h4>
              <ul className="grid gap-1.5">
                {station.requiredDocs.map((d) => (
                  <li key={d} className="flex items-center gap-2 rounded-lg border border-line bg-card px-3 py-2 text-[14px] text-ink">
                    <span style={{ color: "var(--c)" }}>•</span>
                    {d}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* actions */}
          <section className="mt-5 grid gap-2">
            {station.actions.map((a, i) => (
              <button
                key={i}
                onClick={() => handleAction(a)}
                className="btn btn-ghost flex items-center justify-between px-4 py-3 text-left text-[14px]"
              >
                <span className="font-semibold">{a.title}</span>
                {a.meta && <span className="font-mono text-[11px] text-muted">{a.meta}</span>}
              </button>
            ))}
          </section>

          {actionNote && (
            <div className="mt-3 rounded-xl border border-line bg-card px-4 py-3 text-[13px] leading-relaxed text-ink animate-rise">
              {actionNote}
            </div>
          )}

          {answer && (
            <div className="mt-4 rounded-xl border border-line bg-card px-4 py-4">
              <AnswerView result={answer} lang={lang} onAction={handleAction} />
            </div>
          )}

          {/* done toggle */}
          <button
            onClick={onToggleDone}
            className={`btn mt-6 w-full px-4 py-3 text-[15px] ${done ? "btn-ghost" : "btn-signal"}`}
          >
            {done ? `↺ ${t(lang, "undone")}` : `✓ ${t(lang, "done")}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-card px-3 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div className="font-mono text-[13px] text-ink">{value}</div>
    </div>
  );
}

function noteFor(card: ActionCard): string {
  switch (card.kind) {
    case "office":
      return "📍 In the live app this opens a map of the nearest office for your region, with address and opening hours — drawn from Integreat's verified location data.";
    case "appointment":
      return "🗓️ This deep-links into the municipality's official booking page. We never handle your booking data ourselves.";
    case "upload":
      return "📎 Documents you add are checked on your device against the requirements. Nothing is uploaded to a server.";
    case "deadline":
      return "⏰ This adds a private reminder to your device. The date stays in your wallet, on this device only.";
    case "escalate":
      return "🤝 This connects you to free, confidential migration counseling — with an interpreter if you need one. A counselor sees only what you choose to share.";
    case "link":
      return "↗ Opens the relevant official page in Integreat for your region and language.";
    default:
      return "Opens the relevant resource.";
  }
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
