import type { Wallet } from "@/lib/types";

/**
 * Data minimization lives here.
 *
 * The wallet never leaves the device. When a question needs context to be
 * answered well, we derive a small set of *opaque category tags* — never names,
 * never a country of origin, never free identity text. Many users share any
 * given tag combination, so it cannot single someone out.
 */
export function deriveTags(w: Wallet): string[] {
  const tags: string[] = [];
  if (w.profile) tags.push(`status:${w.profile}`);
  if (w.hasChildren) tags.push("family:has_children");
  if (w.hasPartner) tags.push("family:partner");
  // region stays coarse on purpose (the region, not an address)
  tags.push(`region:${w.region}`);
  tags.push(`lang:${w.language}`);
  for (const f of w.flags) {
    if (f === "has_children") continue; // already covered
    tags.push(`flag:${f}`);
  }
  return tags;
}

const PII_PATTERNS: { re: RegExp; replace: string }[] = [
  { re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/gi, replace: "[email]" },
  { re: /\b(?:\+?\d[\d ()-]{6,}\d)\b/g, replace: "[phone]" },
  // street + number
  { re: /\b\d{1,4}\s+[A-Za-zÄÖÜäöüß.-]+(?:stra(?:ss|ß)e|str\.|weg|platz|allee|gasse)\b/gi, replace: "[address]" },
  { re: /\b[A-Za-zÄÖÜäöüß.-]+(?:stra(?:ss|ß)e|str\.|weg|platz|allee|gasse)\s+\d{1,4}\b/gi, replace: "[address]" },
  // German postal codes
  { re: /\b\d{5}\b/g, replace: "[postcode]" },
  // dates of birth-ish
  { re: /\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b/g, replace: "[date]" },
];

/**
 * Strip obvious personal identifiers from a free-text question before it can
 * be sent anywhere. Runs on-device. The same idea exists server-side in the
 * NestJS de-identify guard as defense in depth.
 */
export function deidentify(text: string): string {
  let out = text;
  for (const p of PII_PATTERNS) out = out.replace(p.re, p.replace);
  return out.replace(/\s{2,}/g, " ").trim();
}

/**
 * A combination so specific it could re-identify someone (rare language +
 * tiny region + niche status) gets coarsened before sending.
 */
export function kAnonymityGuard(tags: string[]): string[] {
  const tooSpecific = tags.some((t) => t.startsWith("flag:")) && tags.length > 5;
  if (tooSpecific) {
    // drop the most specific flags, keep coarse status + region
    return tags.filter((t) => !t.startsWith("flag:")).slice(0, 4);
  }
  return tags;
}
