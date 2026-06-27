"use client";
import type { LangCode } from "@/lib/types";
import { t } from "@/lib/i18n";
import { Signpost } from "./Onboarding";

export type Tab = "map" | "guided" | "ask" | "wallet";

export function TopBar({ lang, online }: { lang: LangCode; online: boolean }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/85 backdrop-blur">
      <div className="mx-auto flex max-w-md items-center justify-between px-5 py-3">
        <div className="flex items-center gap-2">
          <Signpost />
          <span className="font-display text-[17px] font-bold tracking-tight text-ink">Wegweiser</span>
        </div>
        <div className="flex items-center gap-1.5 font-mono text-[11px] text-muted">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: online ? "var(--teal)" : "var(--signal)" }} />
          {online ? "AI online" : "on-device"}
        </div>
      </div>
    </header>
  );
}

const TABS: { id: Tab; labelKey: string; icon: JSX.Element }[] = [
  { id: "map", labelKey: "map", icon: <IconMap /> },
  { id: "guided", labelKey: "guided", icon: <IconGuided /> },
  { id: "ask", labelKey: "ask", icon: <IconAsk /> },
  { id: "wallet", labelKey: "wallet", icon: <IconWallet /> },
];

export function TabBar({ tab, setTab, lang }: { tab: Tab; setTab: (t: Tab) => void; lang: LangCode }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper/95 backdrop-blur">
      <div className="mx-auto flex max-w-md items-stretch justify-around px-2 py-2">
        {TABS.map((tb) => {
          const on = tab === tb.id;
          return (
            <button
              key={tb.id}
              onClick={() => setTab(tb.id)}
              className="flex flex-1 flex-col items-center gap-1 rounded-lg py-1.5 transition"
              style={{ color: on ? "var(--ink)" : "var(--muted)" }}
              aria-current={on}
            >
              <span style={{ opacity: on ? 1 : 0.7 }}>{tb.icon}</span>
              <span className="text-[11px] font-medium">{labelFor(tb.id, lang)}</span>
              <span className="h-0.5 w-5 rounded-full transition-all" style={{ background: on ? "var(--signal)" : "transparent" }} />
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function labelFor(id: Tab, lang: LangCode): string {
  if (id === "ask") return t(lang, "free");
  return t(lang, id);
}

function IconMap() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="7" cy="6" r="2" />
      <circle cx="17" cy="18" r="2" />
      <path d="M7 8v4a4 4 0 0 0 4 4h4" strokeLinecap="round" />
    </svg>
  );
}
function IconGuided() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 18h6M10 22h4" strokeLinecap="round" />
      <path d="M12 2a7 7 0 0 0-4 12.7V16h8v-1.3A7 7 0 0 0 12 2z" />
    </svg>
  );
}
function IconAsk() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12a8 8 0 0 1-11.5 7.2L3 21l1.8-6.5A8 8 0 1 1 21 12z" strokeLinejoin="round" />
    </svg>
  );
}
function IconWallet() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M16 12h2" strokeLinecap="round" />
      <path d="M3 9h13a2 2 0 0 1 2 2" />
    </svg>
  );
}
