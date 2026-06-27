"use client";
import { useState } from "react";
import type { AnswerResult, LangCode } from "@/lib/types";
import { t } from "@/lib/i18n";

/**
 * The trust moment: a "receipt" that shows the user the exact de-identified
 * text and opaque tags that would leave their device — and what never does.
 */
export default function PrivacyReceipt({
  result,
  lang,
}: {
  result: AnswerResult;
  lang: LangCode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 rounded-xl border border-line bg-paper/60">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-xs font-medium text-muted">
          <Lock />
          {t(lang, "sendsLabel")}
        </span>
        <span className="font-mono text-[11px] text-muted">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-line px-3 py-3">
          <div>
            <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">Query (de-identified)</div>
            <code className="block rounded-md bg-ink/[0.04] px-2 py-1 font-mono text-[12px] text-ink">
              {result.deidentifiedQuery || "—"}
            </code>
          </div>
          <div>
            <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">Tags (opaque categories)</div>
            <div className="flex flex-wrap gap-1">
              {result.sentTags.length ? (
                result.sentTags.map((tag) => (
                  <span key={tag} className="rounded-md bg-ink/[0.04] px-2 py-0.5 font-mono text-[11px] text-ink">
                    {tag}
                  </span>
                ))
              ) : (
                <span className="text-[12px] text-muted">none</span>
              )}
            </div>
          </div>
          <p className="pt-1 text-[11px] leading-relaxed text-muted">
            Never sent: your name, country of origin, address, documents, or anything you didn't type.
            Answer assembled {result.origin === "device" ? "on your device" : "on the self-hosted server"}.
          </p>
        </div>
      )}
    </div>
  );
}

function Lock() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="4" y="11" width="16" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
