"use client";
import type { Wallet, LangCode, WalletDoc, DocStatus } from "@/lib/types";
import { PROFILES } from "@/data/content";
import { deriveTags } from "@/lib/privacy";
import { setLanguage, addDoc } from "@/lib/wallet";
import { t } from "@/lib/i18n";

const SAMPLE_DOCS: WalletDoc[] = [
  { id: "passport", label: "Passport", status: "valid" },
  { id: "permit", label: "Residence permit", status: "expiring", expiresOn: "2026-10-12" },
  { id: "photo", label: "Biometric photo", status: "review" },
  { id: "insurance", label: "Insurance proof", status: "valid" },
];

const STATUS_META: Record<DocStatus, { glyph: string; tint: string; label: string }> = {
  valid: { glyph: "✓", tint: "var(--signal)", label: "Valid" },
  expiring: { glyph: "!", tint: "var(--amber)", label: "Expiring" },
  missing: { glyph: "×", tint: "var(--rose)", label: "Missing" },
  review: { glyph: "?", tint: "var(--rose)", label: "Needs check" },
};

export default function WalletPanel({
  wallet,
  lang,
  onUpdate,
  onReset,
}: {
  wallet: Wallet;
  lang: LangCode;
  onUpdate: (w: Wallet) => void;
  onReset: () => void;
}) {
  const profile = wallet.profile ? PROFILES[wallet.profile] : undefined;
  const tags = deriveTags(wallet);
  const docs = wallet.documents.length ? wallet.documents : SAMPLE_DOCS;

  return (
    <div className="mx-auto max-w-md px-5 pb-28 pt-4">
      {/* wallet card */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4" style={{ background: "var(--ink)", color: "var(--paper)" }}>
          <div>
            <div className="font-mono text-[11px] uppercase tracking-wide text-paper/70">Personal data wallet</div>
            <div className="font-display text-[18px] font-bold">{profile ? profile.label : "Your situation"}</div>
          </div>
          <div className="text-right">
            <div className="font-mono text-[11px] text-paper/70">{wallet.regionLabel}</div>
            {wallet.guest && (
              <span className="mt-1 inline-block rounded bg-amber px-1.5 py-0.5 font-mono text-[10px] uppercase text-ink">
                guest
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 px-5 py-3 text-[12px] text-muted">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: "var(--signal)" }} />
          {t(lang, "nothingStored")}{wallet.guest ? " · cleared when you close the tab" : ""}
        </div>
      </div>

      {/* documents */}
      <section className="mt-4">
        <h3 className="mb-2 font-display text-[14px] font-semibold uppercase tracking-wide text-muted">Documents</h3>
        <div className="grid gap-2">
          {docs.map((d) => {
            const m = STATUS_META[d.status];
            return (
              <div key={d.id} className="card flex items-center gap-3 px-3.5 py-3">
                <span className="grid h-8 w-8 place-items-center rounded-lg text-[14px] font-bold text-white" style={{ background: m.tint }}>
                  {m.glyph}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold text-ink">{d.label}</div>
                  {d.expiresOn && <div className="font-mono text-[11px] text-muted">expires {fmt(d.expiresOn)}</div>}
                </div>
                <span className="font-mono text-[11px]" style={{ color: m.tint }}>{m.label}</span>
              </div>
            );
          })}
        </div>
        {!wallet.documents.length && (
          <button
            onClick={() => SAMPLE_DOCS.forEach((d) => onUpdate(addDoc(wallet, d)))}
            className="btn btn-ghost mt-2 w-full px-4 py-2.5 text-[13px]"
          >
            + Add these to my wallet (stays on device)
          </button>
        )}
      </section>

      {/* what would be shared */}
      <section className="mt-4">
        <h3 className="mb-2 font-display text-[14px] font-semibold uppercase tracking-wide text-muted">
          What the app can share
        </h3>
        <div className="card px-4 py-3">
          <p className="mb-2 text-[12px] leading-relaxed text-muted">
            Only these opaque tags ever leave your device — never your name, country, address, or documents.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <span key={tag} className="rounded-md bg-ink/[0.05] px-2 py-0.5 font-mono text-[11px] text-ink">{tag}</span>
            ))}
          </div>
        </div>
      </section>

      {/* language + reset */}
      <section className="mt-4 grid gap-2">
        <div className="card flex items-center justify-between px-4 py-3">
          <span className="text-[14px] font-semibold text-ink">Language</span>
          <div className="flex overflow-hidden rounded-lg border border-line">
            {(["en", "de"] as LangCode[]).map((l) => (
              <button
                key={l}
                onClick={() => onUpdate(setLanguage(wallet, l))}
                className="px-3 py-1 font-mono text-[12px] uppercase"
                style={{ background: wallet.language === l ? "var(--ink)" : "transparent", color: wallet.language === l ? "var(--paper)" : "var(--muted)" }}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        <button onClick={onReset} className="btn btn-ghost px-4 py-3 text-[14px] text-rose" style={{ color: "var(--rose)" }}>
          Erase my wallet from this device
        </button>
      </section>
    </div>
  );
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
