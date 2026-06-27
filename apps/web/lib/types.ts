// Core domain types for Wegweiser.

export type ProfileId =
  | "arriving"
  | "asylum"
  | "student"
  | "worker"
  | "eu"
  | "family";

export type LangCode = "en" | "de" | "ar";

export type DocStatus = "valid" | "expiring" | "missing" | "review";

export interface WalletDoc {
  id: string;
  label: string; // human label, e.g. "Passport"
  status: DocStatus;
  expiresOn?: string; // ISO date if known
}

/**
 * The Personal Data Wallet. This object lives ONLY on the user's device
 * (localStorage in normal mode, sessionStorage in guest mode). It is never
 * POSTed as-is. Only de-identified tags derived from it leave the device.
 */
export interface Wallet {
  profile?: ProfileId;
  region: string; // Integreat region slug, e.g. "augsburg"
  regionLabel: string;
  language: LangCode;
  hasChildren: boolean;
  childrenCount: number;
  hasPartner: boolean;
  flags: string[]; // situation chips, e.g. ["no_work_permit", "needs_housing"]
  documents: WalletDoc[];
  completed: string[]; // completed station ids
  guest: boolean;
  createdAt: number;
}

export type ActionKind =
  | "explain"
  | "office"
  | "appointment"
  | "upload"
  | "deadline"
  | "escalate"
  | "checklist"
  | "link";

export interface ActionCard {
  kind: ActionKind;
  title: string;
  body?: string;
  meta?: string; // small label, e.g. "≈ 15 min" or "by 12 Oct 2026"
  href?: string;
}

export interface Source {
  title: string;
  origin: "municipality" | "bamf" | "federal" | "integreat" | "web";
  updatedAt: string; // ISO date
  href?: string;
}

export type LineId = "core" | "asylum" | "student" | "work" | "family";

export interface Station {
  id: string;
  title: string;
  icon: string; // emoji glyph used as a wayfinding marker
  line: LineId;
  estMinutes: number;
  blurb: string; // one-line orientation text
  summary: string; // short explanation shown on expand
  requiredDocs: string[];
  checklist: string[];
  actions: ActionCard[];
  sources: Source[];
  confidence: number; // 0..1
  updatedAt: string; // ISO date — "current legal situation"
  // optional: only show this station if the wallet matches
  requiresFlag?: string;
}

export interface ProfileMeta {
  id: ProfileId;
  label: string;
  glyph: string;
  line: LineId;
  tagline: string;
  stationIds: string[];
}

export interface KbEntry {
  id: string;
  keywords: string[];
  stationId?: string;
  answer: string;
  cards: ActionCard[];
  sources: Source[];
  confidence: number;
}

export interface AnswerResult {
  answer: string;
  cards: ActionCard[];
  sources: Source[];
  confidence: number;
  deidentifiedQuery: string; // exactly what would leave the device
  sentTags: string[]; // opaque category tags derived from the wallet
  escalate: boolean;
  origin: "device" | "server";
}
