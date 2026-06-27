import type { LangCode } from "@/lib/types";

type Dict = Record<string, string>;

const en: Dict = {
  appName: "Wegweiser",
  tagline: "Find your way in Germany, one step at a time.",
  start: "Start my journey",
  guest: "Continue as guest",
  guestNote: "Guest mode keeps everything for this session only.",
  whereTitle: "Where are you right now?",
  whereSub: "We'll build your path from here. No account, no sign-up.",
  yourJourney: "Your journey",
  progress: "complete",
  guided: "Guided",
  free: "Ask freely",
  map: "Map",
  wallet: "Wallet",
  askPlaceholder: "Type your question…",
  sendsLabel: "This is what leaves your device",
  nothingStored: "Stored on this device only",
  required: "What you'll need",
  estTime: "Estimated time",
  done: "Mark as done",
  undone: "Mark as not done",
  sources: "Sources",
  updated: "Updated",
  confidence: "Confidence",
  talkHuman: "Talk to a counselor",
  back: "Back",
};

// Light translations for the demo; production pulls Integreat's full locales.
const de: Dict = {
  ...en,
  tagline: "Finde deinen Weg in Deutschland, Schritt für Schritt.",
  start: "Meinen Weg starten",
  guest: "Als Gast fortfahren",
  guestNote: "Im Gastmodus bleibt alles nur für diese Sitzung.",
  whereTitle: "Wo stehst du gerade?",
  whereSub: "Wir bauen deinen Weg von hier. Kein Konto, keine Anmeldung.",
  yourJourney: "Dein Weg",
  progress: "erledigt",
  guided: "Geführt",
  free: "Frei fragen",
  map: "Karte",
  wallet: "Mappe",
  askPlaceholder: "Stelle deine Frage…",
  sendsLabel: "Das verlässt dein Gerät",
  nothingStored: "Nur auf diesem Gerät gespeichert",
  required: "Was du brauchst",
  estTime: "Geschätzte Zeit",
  done: "Als erledigt markieren",
  undone: "Als offen markieren",
  sources: "Quellen",
  updated: "Aktualisiert",
  confidence: "Konfidenz",
  talkHuman: "Mit Beratung sprechen",
  back: "Zurück",
};

const ar: Dict = {
  ...en,
  tagline: "اعثر على طريقك في ألمانيا، خطوة بخطوة.",
  start: "ابدأ رحلتي",
  guest: "المتابعة كضيف",
  whereTitle: "أين أنت الآن؟",
  whereSub: "سنبني مسارك من هنا. بدون حساب، بدون تسجيل.",
  yourJourney: "رحلتك",
  guided: "موجّه",
  free: "اسأل بحرية",
  map: "الخريطة",
  wallet: "المحفظة",
  askPlaceholder: "اكتب سؤالك…",
  sendsLabel: "هذا ما يغادر جهازك",
  nothingStored: "محفوظ على هذا الجهاز فقط",
  talkHuman: "تحدّث مع مستشار",
  back: "رجوع",
};

const DICTS: Record<LangCode, Dict> = { en, de, ar };

export function t(lang: LangCode, key: string): string {
  return DICTS[lang]?.[key] ?? en[key] ?? key;
}

export function isRTL(lang: LangCode): boolean {
  return lang === "ar";
}
