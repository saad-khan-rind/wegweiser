"use client";
import type { Wallet, Station, LangCode } from "@/lib/types";
import { buildJourney, journeyProgress, type JourneyNode } from "@/lib/engine";
import { t } from "@/lib/i18n";

export default function JourneyMap({
  wallet,
  lang,
  onOpen,
}: {
  wallet: Wallet;
  lang: LangCode;
  onOpen: (st: Station) => void;
}) {
  const nodes = buildJourney(wallet);
  const progress = journeyProgress(nodes);

  return (
    <div className="mx-auto max-w-md px-5 pb-28 pt-4">
      <ProgressHeader progress={progress} lang={lang} nodes={nodes} />

      <div className="relative mt-6">
        {/* the running line */}
        <div className="absolute bottom-6 left-[27px] top-6 w-[3px] rounded-full bg-line" aria-hidden />
        <ol className="relative space-y-3">
          {nodes.map((n, i) => (
            <StationRow key={n.station.id} node={n} index={i} lang={lang} onOpen={onOpen} />
          ))}
        </ol>
      </div>

      <p className="mt-8 text-center text-[12px] leading-relaxed text-muted">
        Tap any stop to see what to do, what to bring, and the latest official sources.
      </p>
    </div>
  );
}

function ProgressHeader({ progress, lang, nodes }: { progress: number; lang: LangCode; nodes: JourneyNode[] }) {
  const remaining = nodes.filter((n) => !n.done).length;
  return (
    <div className="card px-4 py-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-[20px] font-bold text-ink">{t(lang, "yourJourney")}</h2>
        <span className="font-mono text-[13px] text-muted">
          {progress}% {t(lang, "progress")}
        </span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-ink/[0.06]">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${progress}%`, background: "var(--signal)" }}
        />
      </div>
      <p className="mt-2 text-[12px] text-muted">
        {remaining === 0 ? "All steps done — well done." : `${remaining} step${remaining > 1 ? "s" : ""} ahead of you.`}
      </p>
    </div>
  );
}

function StationRow({
  node,
  index,
  lang,
  onOpen,
}: {
  node: JourneyNode;
  index: number;
  lang: LangCode;
  onOpen: (st: Station) => void;
}) {
  const { station, done, current } = node;
  return (
    <li className={`line-${station.line} relative flex items-stretch gap-3`}>
      {/* marker */}
      <div className="relative z-10 flex w-[56px] shrink-0 justify-center pt-1">
        <Marker icon={station.icon} done={done} current={current} />
      </div>

      <button
        onClick={() => onOpen(station)}
        className="card group flex flex-1 items-center gap-3 px-3.5 py-3 text-left transition hover:-translate-y-[1px]"
        style={current ? { boxShadow: "0 0 0 2px var(--signal), 0 10px 30px -22px rgba(22,36,59,.4)" } : undefined}
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            {current && (
              <span
                className="rounded px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase"
                style={{ background: "var(--signal)", color: "#14210a" }}
              >
                you are here
              </span>
            )}
            {done && <span className="font-mono text-[11px] text-muted">done</span>}
          </span>
          <span className={`font-display text-[15px] font-semibold ${done ? "text-muted line-through" : "text-ink"}`}>
            {station.title}
          </span>
          <span className="mt-0.5 block text-[12.5px] leading-snug text-muted">{station.blurb}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          {station.estMinutes > 0 && (
            <span className="font-mono text-[11px] text-muted">≈{station.estMinutes}m</span>
          )}
          <span className="text-muted transition group-hover:translate-x-0.5" style={{ color: "var(--c)" }}>
            →
          </span>
        </span>
      </button>
    </li>
  );
}

function Marker({ icon, done, current }: { icon: string; done: boolean; current: boolean }) {
  if (done) {
    return (
      <span
        className="grid h-9 w-9 place-items-center rounded-full text-white shadow"
        style={{ background: "var(--c)" }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
          <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  return (
    <span className="relative grid h-9 w-9 place-items-center">
      {current && (
        <span
          className="absolute inset-0 rounded-full animate-pulsehere"
          style={{ boxShadow: "0 0 0 3px var(--signal)" }}
          aria-hidden
        />
      )}
      <span
        className="grid h-9 w-9 place-items-center rounded-full bg-card text-[16px]"
        style={{ boxShadow: `inset 0 0 0 3px var(--c)` }}
      >
        {icon}
      </span>
    </span>
  );
}
