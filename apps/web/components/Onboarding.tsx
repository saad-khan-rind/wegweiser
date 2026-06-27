"use client";
import { useState } from "react";
import type { Wallet, ProfileId, LangCode } from "@/lib/types";
import { PROFILES } from "@/data/content";
import { emptyWallet, setProfile } from "@/lib/wallet";
import { t, isRTL } from "@/lib/i18n";

export default function Onboarding({ onReady }: { onReady: (w: Wallet) => void }) {
  const [lang, setLang] = useState<LangCode>("en");
  const [guest, setGuest] = useState(false);

  function pick(id: ProfileId) {
    let w = emptyWallet(guest);
    w = { ...w, language: lang };
    w = setProfile(w, id);
    onReady(w);
  }

  return (
    <div dir={isRTL(lang) ? "rtl" : "ltr"} className="mx-auto flex min-h-[100dvh] max-w-md flex-col px-5 py-7">
      <header className="flex items-center justify-between">
        <Brand />
        <LangSwitch lang={lang} setLang={setLang} />
      </header>

      <div className="mt-10">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1 font-mono text-[11px] text-muted">
          <Dot /> {t(lang, "nothingStored")}
        </div>
        <h1 className="font-display text-[34px] font-700 leading-[1.05] text-ink" style={{ fontWeight: 700 }}>
          {t(lang, "whereTitle")}
        </h1>
        <p className="mt-2 max-w-sm text-[15px] leading-relaxed text-muted">{t(lang, "whereSub")}</p>
      </div>

      <div className="mt-7 grid gap-2.5">
        {Object.values(PROFILES).map((p) => (
          <button
            key={p.id}
            onClick={() => pick(p.id)}
            className={`card line-${p.line} group flex items-center gap-4 px-4 py-4 text-left transition hover:-translate-y-[1px]`}
          >
            <span
              className="grid h-12 w-12 shrink-0 place-items-center rounded-xl text-2xl"
              style={{ background: "color-mix(in srgb, var(--c) 12%, white)" }}
            >
              {p.glyph}
            </span>
            <span className="min-w-0 flex-1">
              <span className="font-display text-[17px] font-semibold text-ink">{p.label}</span>
              <span className="mt-0.5 block text-[13px] leading-snug text-muted">{p.tagline}</span>
            </span>
            <span className="shrink-0 text-muted transition group-hover:translate-x-0.5" style={{ color: "var(--c)" }}>
              →
            </span>
          </button>
        ))}
      </div>

      <div className="mt-6 flex items-center justify-between rounded-xl border border-line bg-card px-4 py-3">
        <div>
          <div className="text-[14px] font-semibold text-ink">{t(lang, "guest")}</div>
          <div className="text-[12px] text-muted">{t(lang, "guestNote")}</div>
        </div>
        <button
          role="switch"
          aria-checked={guest}
          onClick={() => setGuest((g) => !g)}
          className="relative h-7 w-12 rounded-full transition"
          style={{ background: guest ? "var(--signal)" : "var(--line)" }}
        >
          <span
            className="absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all"
            style={{ left: guest ? "1.5rem" : "0.125rem" }}
          />
        </button>
      </div>

      <p className="mt-auto pt-8 text-center text-[11px] leading-relaxed text-muted">
        Built with Integreat · Tür an Tür Digitalfabrik. Open source, open weights, self-hostable.
      </p>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2">
      <Signpost />
      <span className="font-display text-[18px] font-bold tracking-tight text-ink">Wegweiser</span>
    </div>
  );
}

export function Signpost() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 3v18" stroke="var(--ink)" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M12 6h6l2.2 2.2L18 10.4h-6z" fill="var(--signal)" />
      <path d="M12 12H6L3.8 14.2 6 16.4h6z" fill="var(--ink)" />
    </svg>
  );
}

function LangSwitch({ lang, setLang }: { lang: LangCode; setLang: (l: LangCode) => void }) {
  const langs: LangCode[] = ["en", "de", "ar"];
  return (
    <div className="flex overflow-hidden rounded-lg border border-line bg-card">
      {langs.map((l) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          className="px-2.5 py-1 font-mono text-[12px] uppercase transition"
          style={{ background: lang === l ? "var(--ink)" : "transparent", color: lang === l ? "var(--paper)" : "var(--muted)" }}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

function Dot() {
  return <span className="inline-block h-2 w-2 rounded-full" style={{ background: "var(--signal)" }} />;
}
