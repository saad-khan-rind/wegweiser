"use client";
import type { Wallet, WalletDoc, LangCode, ProfileId } from "@/lib/types";

const KEY = "wegweiser.wallet.v1";

export function emptyWallet(guest: boolean): Wallet {
  return {
    region: "augsburg",
    regionLabel: "Augsburg",
    language: "en",
    hasChildren: false,
    childrenCount: 0,
    hasPartner: false,
    flags: [],
    documents: [],
    completed: [],
    guest,
    createdAt: Date.now(),
  };
}

/** Guest mode keeps the wallet in sessionStorage (cleared when the tab closes). */
function store(guest: boolean): Storage | null {
  if (typeof window === "undefined") return null;
  return guest ? window.sessionStorage : window.localStorage;
}

export function loadWallet(): Wallet | null {
  if (typeof window === "undefined") return null;
  const fromSession = window.sessionStorage.getItem(KEY);
  const fromLocal = window.localStorage.getItem(KEY);
  const raw = fromSession || fromLocal;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Wallet;
  } catch {
    return null;
  }
}

export function saveWallet(w: Wallet) {
  const s = store(w.guest);
  if (!s) return;
  // Make sure a wallet only lives in one place.
  window.sessionStorage.removeItem(KEY);
  window.localStorage.removeItem(KEY);
  s.setItem(KEY, JSON.stringify(w));
}

export function clearWallet() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(KEY);
  window.localStorage.removeItem(KEY);
}

export function setProfile(w: Wallet, profile: ProfileId): Wallet {
  return { ...w, profile };
}

export function toggleFlag(w: Wallet, flag: string): Wallet {
  const flags = w.flags.includes(flag)
    ? w.flags.filter((f) => f !== flag)
    : [...w.flags, flag];
  return { ...w, flags };
}

export function setLanguage(w: Wallet, language: LangCode): Wallet {
  return { ...w, language };
}

export function setChildren(w: Wallet, count: number): Wallet {
  const hasChildren = count > 0;
  const flags = hasChildren
    ? Array.from(new Set([...w.flags, "has_children"]))
    : w.flags.filter((f) => f !== "has_children");
  return { ...w, childrenCount: count, hasChildren, flags };
}

export function addDoc(w: Wallet, doc: WalletDoc): Wallet {
  return { ...w, documents: [...w.documents.filter((d) => d.id !== doc.id), doc] };
}

export function completeStation(w: Wallet, id: string): Wallet {
  if (w.completed.includes(id)) {
    return { ...w, completed: w.completed.filter((c) => c !== id) };
  }
  return { ...w, completed: [...w.completed, id] };
}
