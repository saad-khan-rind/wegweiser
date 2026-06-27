"use client";
import { useState } from "react";
import { ingestText, ingestFile, listDocuments, refreshCrawl, getHealth } from "@/lib/api";

type Status = { kind: "idle" | "ok" | "err" | "busy"; msg: string };

export default function AdminPage() {
  const [token, setToken] = useState("");
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("");
  const [url, setUrl] = useState("");
  const [date, setDate] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [region, setRegion] = useState("bavaria");
  const [lang, setLang] = useState("en");
  const [status, setStatus] = useState<Status>({ kind: "idle", msg: "" });
  const [docs, setDocs] = useState<any[]>([]);
  const [health, setHealth] = useState<any>(null);

  function reset() {
    setTitle(""); setSource(""); setUrl(""); setDate(""); setText(""); setFile(null);
  }

  async function onIngestText() {
    if (!title.trim() || !text.trim()) { setStatus({ kind: "err", msg: "Title and text are required." }); return; }
    setStatus({ kind: "busy", msg: "Embedding and storing in the vector database…" });
    try {
      const r = await ingestText({ title, text, source, url, date }, token);
      setStatus({ kind: "ok", msg: `Stored "${title}" as ${r.chunks} chunk(s) in the vector DB.` });
      reset();
    } catch (e) { setStatus({ kind: "err", msg: (e as Error).message }); }
  }

  async function onIngestFile() {
    if (!file) { setStatus({ kind: "err", msg: "Choose a file first (.pdf, .txt, .md)." }); return; }
    setStatus({ kind: "busy", msg: `Uploading and indexing ${file.name}…` });
    try {
      const r = await ingestFile(file, { title: title || file.name, source, url, date }, token);
      setStatus({ kind: "ok", msg: `Indexed "${r.title}" as ${r.chunks} chunk(s).` });
      reset();
    } catch (e) { setStatus({ kind: "err", msg: (e as Error).message }); }
  }

  async function onList() {
    setStatus({ kind: "busy", msg: "Loading documents…" });
    try {
      const r = await listDocuments(token);
      setDocs(r.documents ?? []);
      setStatus({ kind: "ok", msg: `${(r.documents ?? []).length} entries in the store.` });
    } catch (e) { setStatus({ kind: "err", msg: (e as Error).message }); }
  }

  async function onRefresh() {
    setStatus({ kind: "busy", msg: `Crawling the latest official content for ${region}/${lang}...` });
    try {
      const r = await refreshCrawl(region, lang, token);
      setStatus({ kind: "ok", msg: `Crawled ${r.pages} latest pages for ${region}/${lang}.` });
    } catch (e) { setStatus({ kind: "err", msg: (e as Error).message }); }
  }

  async function onHealth() {
    setStatus({ kind: "busy", msg: "Checking API, AI service, and vector store..." });
    try {
      const r = await getHealth();
      setHealth(r);
      const pinecone = r.ai?.pinecone;
      const backend = pinecone?.backend || r.ai?.vector_store || "unknown";
      setStatus({ kind: "ok", msg: `AI reachable. Vector store: ${backend}.` });
    } catch (e) { setStatus({ kind: "err", msg: (e as Error).message }); }
  }

  return (
    <div className="mx-auto max-w-2xl px-5 py-8">
      <header className="mb-6">
        <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted">Wegweiser · Admin</div>
        <h1 className="mt-1 font-display text-[26px] font-bold text-ink">Knowledge base</h1>
        <p className="mt-1 text-[14px] text-muted">
          Upload official documents for newcomers. Each document is embedded and stored in the vector
          database (Pinecone), then used by the assistant's retrieval — with the source cited in answers.
        </p>
      </header>

      <section className="card mb-4 px-4 py-4">
        <label className="mb-1 block text-[12px] font-medium text-ink">Admin token</label>
        <input
          value={token} onChange={(e) => setToken(e.target.value)} type="password"
          placeholder="x-admin-token (leave blank if not configured)"
          className="h-11 w-full rounded-xl border border-line bg-paper px-3 text-[15px] text-ink outline-none focus:border-ink"
        />
      </section>

      <section className="card mb-4 px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-[18px] font-bold text-ink">System status</h2>
            <p className="mt-1 text-[13px] text-muted">
              Check whether the API, AI service, and Pinecone-backed vector store are connected.
            </p>
          </div>
          <button onClick={onHealth} className="chip shrink-0 px-3 py-1.5 text-[13px]">Check</button>
        </div>
        {health && (
          <dl className="mt-3 grid grid-cols-1 gap-2 text-[13px] sm:grid-cols-2">
            <StatusItem label="API" value={health.ok ? "online" : "offline"} />
            <StatusItem label="AI service" value={health.ai?.ok ? "online" : "not reachable"} />
            <StatusItem label="Vector store" value={health.ai?.pinecone?.backend || health.ai?.vector_store || "unknown"} />
            <StatusItem label="Pinecone configured" value={health.ai?.pinecone?.configured ? "yes" : "no"} />
            <StatusItem label="Embeddings" value={`${health.ai?.pinecone?.embedding_provider || "unknown"} (${health.ai?.pinecone?.embedding_dim || "?"})`} />
            <StatusItem label="LLM" value={health.ai?.llm?.provider || "unknown"} />
            {health.ai?.pinecone?.last_error && (
              <div className="sm:col-span-2 rounded-lg border border-line bg-paper px-3 py-2 text-rose">
                Pinecone error: {health.ai.pinecone.last_error}
              </div>
            )}
          </dl>
        )}
      </section>

      <section className="card mb-4 px-4 py-4">
        <h2 className="font-display text-[18px] font-bold text-ink">Document details</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Title *" value={title} set={setTitle} placeholder="e.g. Residence permit renewal 2026" />
          <Field label="Source" value={source} set={setSource} placeholder="e.g. Ausländerbehörde Augsburg" />
          <Field label="Source URL" value={url} set={setUrl} placeholder="https://…" />
          <Field label="Last updated" value={date} set={setDate} placeholder="2026-06-01" />
        </div>

        <div className="mt-4">
          <label className="mb-1 block text-[12px] font-medium text-ink">Paste text</label>
          <textarea
            value={text} onChange={(e) => setText(e.target.value)} rows={6}
            placeholder="Paste the document content here…"
            className="w-full resize-y rounded-xl border border-line bg-paper px-3 py-2.5 text-[14px] text-ink outline-none focus:border-ink"
          />
          <button onClick={onIngestText} className="btn btn-primary mt-2 h-11 px-4 text-[14px]">
            Store text in vector DB
          </button>
        </div>

        <div className="mt-5 border-t border-line pt-4">
          <label className="mb-1 block text-[12px] font-medium text-ink">…or upload a file (.pdf, .txt, .md)</label>
          <input
            type="file" accept=".pdf,.txt,.md,.markdown"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-[13px] text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-ink file:px-3 file:py-2 file:text-paper"
          />
          <button onClick={onIngestFile} className="btn btn-signal mt-2 h-11 px-4 text-[14px]">
            Upload & index file
          </button>
        </div>
      </section>

      <section className="card mb-4 px-4 py-4">
        <h2 className="font-display text-[18px] font-bold text-ink">Always-latest crawl</h2>
        <p className="mt-1 text-[13px] text-muted">
          Pull fresh official migration information into the vector DB on demand. Bavaria/general uses official public sources; city names use Integreat when available.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-[11px] text-muted">Region</label>
            <input value={region} onChange={(e) => setRegion(e.target.value)}
              className="h-10 w-40 rounded-xl border border-line bg-paper px-3 text-[14px] text-ink outline-none focus:border-ink" />
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-muted">Language</label>
            <select value={lang} onChange={(e) => setLang(e.target.value)}
              className="h-10 w-28 rounded-xl border border-line bg-paper px-3 text-[14px] text-ink outline-none focus:border-ink">
              <option value="en">English</option>
              <option value="de">German</option>
            </select>
          </div>
          <button onClick={onRefresh} className="btn btn-primary h-10 px-4 text-[14px]">Crawl latest</button>
        </div>
      </section>

      <section className="card px-4 py-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-[18px] font-bold text-ink">Stored documents</h2>
          <button onClick={onList} className="chip px-3 py-1.5 text-[13px]">Refresh list</button>
        </div>
        {docs.length > 0 && (
          <ul className="mt-3 space-y-1">
            {docs.slice(0, 100).map((d, i) => (
              <li key={i} className="flex items-center justify-between gap-2 border-b border-line/60 py-1.5 text-[13px]">
                <span className="truncate text-ink">{d.metadata?.title || d.id}</span>
                <span className="shrink-0 font-mono text-[11px] text-muted">{d.metadata?.source || d.metadata?.total || ""}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {status.kind !== "idle" && (
        <div
          className="mt-4 rounded-xl px-4 py-3 text-[13px]"
          style={{
            background:
              status.kind === "ok" ? "color-mix(in srgb, var(--signal) 14%, white)"
              : status.kind === "err" ? "color-mix(in srgb, var(--rose) 12%, white)"
              : "color-mix(in srgb, var(--amber) 12%, white)",
            border: "1.5px solid var(--line)",
            color: "var(--ink)",
          }}
        >
          {status.kind === "busy" ? "⏳ " : status.kind === "ok" ? "✓ " : "⚠ "}{status.msg}
        </div>
      )}

      <p className="mt-6 text-center text-[12px] text-muted">
        <a href={`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/`} className="underline">← Back to Wegweiser</a>
      </p>
    </div>
  );
}

function Field({ label, value, set, placeholder }: { label: string; value: string; set: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="mb-1 block text-[12px] font-medium text-ink">{label}</label>
      <input
        value={value} onChange={(e) => set(e.target.value)} placeholder={placeholder}
        className="h-11 w-full rounded-xl border border-line bg-paper px-3 text-[15px] text-ink outline-none focus:border-ink"
      />
    </div>
  );
}

function StatusItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-paper px-3 py-2">
      <dt className="font-mono text-[10px] uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 font-medium text-ink">{value}</dd>
    </div>
  );
}
