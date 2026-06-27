"use client";
import type { Wallet, LangCode } from "@/lib/types";
import { nextInterviewQuestions } from "@/lib/engine";
import { t } from "@/lib/i18n";

export default function GuidedInterview({
  wallet,
  lang,
  onUpdate,
  onDone,
}: {
  wallet: Wallet;
  lang: LangCode;
  onUpdate: (w: Wallet) => void;
  onDone: () => void;
}) {
  const questions = nextInterviewQuestions(wallet);
  const q = questions[0];

  if (!q) {
    return (
      <div className="mx-auto max-w-md px-5 pb-28 pt-4">
        <div className="card px-5 py-8 text-center">
          <div className="text-3xl">✅</div>
          <h2 className="mt-2 font-display text-[20px] font-bold text-ink">Your path is ready</h2>
          <p className="mt-1 text-[14px] text-muted">
            We tuned your journey from your answers. Everything stayed on this device.
          </p>
          <button onClick={onDone} className="btn btn-signal mt-5 w-full px-4 py-3 text-[15px]">
            See my journey →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-5 pb-28 pt-4">
      <div className="mb-2 flex items-center gap-2 font-mono text-[11px] text-muted">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: "var(--signal)" }} />
        {t(lang, "guided")} · we ask only what improves your answer
      </div>
      <div className="card px-5 py-6 animate-rise">
        <h2 className="font-display text-[22px] font-bold leading-snug text-ink">{q.prompt}</h2>
        <div className="mt-5 grid gap-2.5">
          {q.options.map((opt, i) => (
            <button
              key={i}
              onClick={() => onUpdate(opt.apply(wallet))}
              className="btn btn-ghost px-4 py-3.5 text-left text-[15px] font-semibold hover:border-ink"
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-3 text-center text-[12px] text-muted">
        Each answer is a tap, never free text. You can skip anything.
      </p>
    </div>
  );
}
