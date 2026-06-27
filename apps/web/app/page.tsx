"use client";
import { useEffect, useState } from "react";
import type { Wallet, Station } from "@/lib/types";
import { loadWallet, saveWallet, clearWallet } from "@/lib/wallet";
import { apiConfigured } from "@/lib/api";
import { isRTL } from "@/lib/i18n";
import { completeStation } from "@/lib/wallet";

import Onboarding from "@/components/Onboarding";
import JourneyMap from "@/components/JourneyMap";
import StationSheet from "@/components/StationSheet";
import FreeForm from "@/components/FreeForm";
import GuidedInterview from "@/components/GuidedInterview";
import WalletPanel from "@/components/WalletPanel";
import { TopBar, TabBar, type Tab } from "@/components/Shell";

export default function Page() {
  const [mounted, setMounted] = useState(false);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [tab, setTab] = useState<Tab>("map");
  const [openStation, setOpenStation] = useState<Station | null>(null);

  useEffect(() => {
    setWallet(loadWallet());
    setMounted(true);
  }, []);

  function update(w: Wallet) {
    saveWallet(w);
    setWallet({ ...w });
  }

  function reset() {
    clearWallet();
    setWallet(null);
    setTab("map");
  }

  // Avoid hydration mismatch: render nothing until we've read storage.
  if (!mounted) return <div className="min-h-[100dvh]" />;

  if (!wallet) {
    return <Onboarding onReady={update} />;
  }

  const lang = wallet.language;
  const isDone = openStation ? wallet.completed.includes(openStation.id) : false;

  return (
    <div dir={isRTL(lang) ? "rtl" : "ltr"} className="min-h-[100dvh]">
      <TopBar lang={lang} online={apiConfigured()} />

      <main>
        {tab === "map" && <JourneyMap wallet={wallet} lang={lang} onOpen={setOpenStation} />}
        {tab === "guided" && (
          <GuidedInterview
            wallet={wallet}
            lang={lang}
            onUpdate={update}
            onDone={() => setTab("map")}
          />
        )}
        {tab === "ask" && <FreeForm wallet={wallet} lang={lang} />}
        {tab === "wallet" && (
          <WalletPanel wallet={wallet} lang={lang} onUpdate={update} onReset={reset} />
        )}
      </main>

      {openStation && (
        <StationSheet
          station={openStation}
          done={isDone}
          lang={lang}
          onClose={() => setOpenStation(null)}
          onToggleDone={() => {
            update(completeStation(wallet, openStation.id));
          }}
        />
      )}

      <TabBar tab={tab} setTab={setTab} lang={lang} />
    </div>
  );
}
