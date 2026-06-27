/**
 * Defense in depth. The web client already de-identifies before sending, but
 * the server never trusts that — it strips identifiers again here, so even a
 * misbehaving client can't get raw PII into the LLM or any log.
 */
const PII: { re: RegExp; with: string }[] = [
  { re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/gi, with: "[email]" },
  { re: /\b(?:\+?\d[\d ()-]{6,}\d)\b/g, with: "[phone]" },
  { re: /\b\d{1,4}\s+[A-Za-zÄÖÜäöüß.-]+(?:stra(?:ss|ß)e|str\.|weg|platz|allee|gasse)\b/gi, with: "[address]" },
  { re: /\b[A-Za-zÄÖÜäöüß.-]+(?:stra(?:ss|ß)e|str\.|weg|platz|allee|gasse)\s+\d{1,4}\b/gi, with: "[address]" },
  { re: /\b\d{5}\b/g, with: "[postcode]" },
];

export function deidentify(text: string): string {
  let out = text ?? "";
  for (const p of PII) out = out.replace(p.re, p.with);
  return out.replace(/\s{2,}/g, " ").trim();
}

/** Only opaque category tags are accepted; anything that looks like free text is dropped. */
export function sanitizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return tags
    .filter((t): t is string => typeof t === "string")
    .filter((t) => /^[a-z_]+:[a-z0-9_-]+$/i.test(t))
    .slice(0, 12);
}
