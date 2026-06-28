import { useEffect, useState } from 'react'
import {
  adminLogin,
  adminVerify,
  apiConfigured,
  clearDocuments,
  getHealth,
  ingestFile,
  ingestText,
  listDocuments,
  refreshCrawl,
} from '../services/apiClient'

const TOKEN_KEY = 'wegweiser_admin_token'

function readToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY) || ''
  } catch {
    return ''
  }
}

function writeToken(token) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token)
    else sessionStorage.removeItem(TOKEN_KEY)
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Login screen
// ---------------------------------------------------------------------------
function LoginScreen({ onAuthenticated }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const configured = apiConfigured()

  async function submit(e) {
    e?.preventDefault()
    if (!email.trim() || !password) {
      setError('Enter your email and password.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const { token, email: who } = await adminLogin(email.trim(), password)
      writeToken(token)
      onAuthenticated(token, who)
    } catch (err) {
      setError(err.message || 'Login failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-white via-slate-50 to-civic-purple-light/30 px-5">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-slate-400">
          Wegweiser · Admin
        </div>
        <h1 className="mt-1 text-2xl font-bold text-charcoal">Sign in</h1>
        <p className="mt-1 text-sm text-slate-500">
          Manage the knowledge base used by the assistant.
        </p>

        {!configured && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-700">
            The API URL is not configured. Set <code>API_URL</code> on the web container.
          </div>
        )}

        <label className="mt-5 block text-[12px] font-medium text-charcoal">Email</label>
        <input
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="admin@example.com"
          className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-[15px] text-charcoal outline-none focus:border-civic-purple focus:ring-2 focus:ring-civic-purple/20"
        />

        <label className="mt-3 block text-[12px] font-medium text-charcoal">Password</label>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-[15px] text-charcoal outline-none focus:border-civic-purple focus:ring-2 focus:ring-civic-purple/20"
        />

        {error && <p className="mt-3 text-[13px] font-medium text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-xl bg-civic-purple px-5 text-sm font-semibold text-white transition-colors hover:bg-civic-purple-dark disabled:opacity-60"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="mt-5 text-center text-[12px] text-slate-400">
          <a href="/" className="underline">
            ← Back to Wegweiser
          </a>
        </p>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Admin dashboard (ported feature set, now behind login + bearer token)
// ---------------------------------------------------------------------------
function Field({ label, value, set, placeholder }) {
  return (
    <div>
      <label className="mb-1 block text-[12px] font-medium text-charcoal">{label}</label>
      <input
        value={value}
        onChange={(e) => set(e.target.value)}
        placeholder={placeholder}
        className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-[15px] text-charcoal outline-none focus:border-civic-purple focus:ring-2 focus:ring-civic-purple/20"
      />
    </div>
  )
}

function StatusItem({ label, value }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <dt className="font-mono text-[10px] uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 font-medium text-charcoal">{value}</dd>
    </div>
  )
}

function AdminDashboard({ token, email, onLogout }) {
  const [title, setTitle] = useState('')
  const [source, setSource] = useState('')
  const [url, setUrl] = useState('')
  const [date, setDate] = useState('')
  const [text, setText] = useState('')
  const [file, setFile] = useState(null)
  const [region, setRegion] = useState('bavaria')
  const [lang, setLang] = useState('en')
  const [apiUrl, setApiUrl] = useState(
    'https://cms.integreat-app.de/testumgebung-frag-integreat/de/wp-json/extensions/v3/pages/',
  )
  const [status, setStatus] = useState({ kind: 'idle', msg: '' })
  const [docs, setDocs] = useState([])
  const [health, setHealth] = useState(null)

  function reset() {
    setTitle('')
    setSource('')
    setUrl('')
    setDate('')
    setText('')
    setFile(null)
  }

  // A 401 means the token expired / is invalid — bounce back to login.
  function handleError(e) {
    const msg = e?.message || 'Something went wrong.'
    if (/401|unauthor|expired|token/i.test(msg)) {
      onLogout()
      return
    }
    setStatus({ kind: 'err', msg })
  }

  async function onIngestText() {
    if (!title.trim() || !text.trim()) {
      setStatus({ kind: 'err', msg: 'Title and text are required.' })
      return
    }
    setStatus({ kind: 'busy', msg: 'Embedding and storing in the vector database…' })
    try {
      const r = await ingestText({ title, text, source, url, date }, token)
      setStatus({ kind: 'ok', msg: `Stored "${title}" as ${r.chunks} chunk(s) in the vector DB.` })
      reset()
    } catch (e) {
      handleError(e)
    }
  }

  async function onIngestFile() {
    if (!file) {
      setStatus({ kind: 'err', msg: 'Choose a file first (.pdf, .txt, .md).' })
      return
    }
    setStatus({ kind: 'busy', msg: `Uploading and indexing ${file.name}…` })
    try {
      const r = await ingestFile(file, { title: title || file.name, source, url, date }, token)
      setStatus({ kind: 'ok', msg: `Indexed "${r.title}" as ${r.chunks} chunk(s).` })
      reset()
    } catch (e) {
      handleError(e)
    }
  }

  async function onList() {
    setStatus({ kind: 'busy', msg: 'Loading documents…' })
    try {
      const r = await listDocuments(token)
      setDocs(r.documents ?? [])
      setStatus({ kind: 'ok', msg: `${(r.documents ?? []).length} entries in the store.` })
    } catch (e) {
      handleError(e)
    }
  }

  async function onRefresh() {
    const importUrl = apiUrl.trim()
    setStatus({
      kind: 'busy',
      msg: importUrl
        ? 'Importing structured Integreat API pages…'
        : `Crawling the latest official content for ${region}/${lang}…`,
    })
    try {
      const r = await refreshCrawl(region, lang, token, importUrl)
      setStatus({
        kind: 'ok',
        msg: importUrl
          ? `Imported ${r.pages} structured pages for ${r.region}/${r.lang}.`
          : `Crawled ${r.pages} latest pages for ${region}/${lang}.`,
      })
    } catch (e) {
      handleError(e)
    }
  }

  async function onClear() {
    if (
      !confirm(
        'Clear all vector DB records? This removes uploaded documents and crawled pages from the current index.',
      )
    )
      return
    setStatus({ kind: 'busy', msg: 'Clearing vector database…' })
    try {
      const r = await clearDocuments(token)
      setDocs([])
      setStatus({ kind: 'ok', msg: `Cleared ${r.deleted ?? 0} vector(s).` })
    } catch (e) {
      handleError(e)
    }
  }

  async function onHealth() {
    setStatus({ kind: 'busy', msg: 'Checking API, AI service, and vector store…' })
    try {
      const r = await getHealth()
      setHealth(r)
      const pinecone = r.ai?.pinecone
      const backend = pinecone?.backend || r.ai?.vector_store || 'unknown'
      setStatus({ kind: 'ok', msg: `AI reachable. Vector store: ${backend}.` })
    } catch (e) {
      handleError(e)
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-5 py-8">
      <header className="mb-6 flex items-start justify-between gap-3">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-slate-400">
            Wegweiser · Admin
          </div>
          <h1 className="mt-1 text-[26px] font-bold text-charcoal">Knowledge base</h1>
          <p className="mt-1 text-[14px] text-slate-500">
            Upload official documents for newcomers. Each document is embedded and stored in the
            vector database, then used by the assistant&apos;s retrieval — with the source cited in
            answers.
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[12px] text-slate-500">{email}</div>
          <button
            onClick={onLogout}
            className="mt-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-[12px] font-semibold text-charcoal hover:border-civic-purple hover:text-civic-purple"
          >
            Sign out
          </button>
        </div>
      </header>

      <section className="mb-4 rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-[18px] font-bold text-charcoal">System status</h2>
            <p className="mt-1 text-[13px] text-slate-500">
              Check whether the API, AI service, and vector store are connected.
            </p>
          </div>
          <button
            onClick={onHealth}
            className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[13px] font-semibold text-charcoal hover:border-civic-purple hover:text-civic-purple"
          >
            Check
          </button>
        </div>
        {health && (
          <dl className="mt-3 grid grid-cols-1 gap-2 text-[13px] sm:grid-cols-2">
            <StatusItem label="API" value={health.ok ? 'online' : 'offline'} />
            <StatusItem label="AI service" value={health.ai?.ok ? 'online' : 'not reachable'} />
            <StatusItem
              label="Vector store"
              value={health.ai?.pinecone?.backend || health.ai?.vector_store || 'unknown'}
            />
            <StatusItem
              label="Pinecone configured"
              value={health.ai?.pinecone?.configured ? 'yes' : 'no'}
            />
            <StatusItem
              label="Embeddings"
              value={`${health.ai?.pinecone?.embedding_provider || 'unknown'} (${
                health.ai?.pinecone?.embedding_dim || '?'
              })`}
            />
            <StatusItem
              label="LLM"
              value={`${health.ai?.llm?.provider || 'unknown'} / ${
                health.ai?.llm?.chat_model || 'unknown'
              }`}
            />
            {health.ai?.pinecone?.last_error && (
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-red-600 sm:col-span-2">
                Pinecone error: {health.ai.pinecone.last_error}
              </div>
            )}
          </dl>
        )}
      </section>

      <section className="mb-4 rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
        <h2 className="text-[18px] font-bold text-charcoal">Document details</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Title *" value={title} set={setTitle} placeholder="e.g. Residence permit renewal 2026" />
          <Field label="Source" value={source} set={setSource} placeholder="e.g. Ausländerbehörde Augsburg" />
          <Field label="Source URL" value={url} set={setUrl} placeholder="https://…" />
          <Field label="Last updated" value={date} set={setDate} placeholder="2026-06-01" />
        </div>

        <div className="mt-4">
          <label className="mb-1 block text-[12px] font-medium text-charcoal">Paste text</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            placeholder="Paste the document content here…"
            className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[14px] text-charcoal outline-none focus:border-civic-purple focus:ring-2 focus:ring-civic-purple/20"
          />
          <button
            onClick={onIngestText}
            className="mt-2 inline-flex h-11 items-center justify-center rounded-xl bg-civic-purple px-4 text-[14px] font-semibold text-white hover:bg-civic-purple-dark"
          >
            Store text in vector DB
          </button>
        </div>

        <div className="mt-5 border-t border-slate-100 pt-4">
          <label className="mb-1 block text-[12px] font-medium text-charcoal">
            …or upload a file (.pdf, .txt, .md)
          </label>
          <input
            type="file"
            accept=".pdf,.txt,.md,.markdown"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-[13px] text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-charcoal file:px-3 file:py-2 file:text-white"
          />
          <button
            onClick={onIngestFile}
            className="mt-2 inline-flex h-11 items-center justify-center rounded-xl bg-gentle-emerald px-4 text-[14px] font-semibold text-white hover:bg-emerald-600"
          >
            Upload &amp; index file
          </button>
        </div>
      </section>

      <section className="mb-4 rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
        <h2 className="text-[18px] font-bold text-charcoal">Always-latest crawl</h2>
        <p className="mt-1 text-[13px] text-slate-500">
          Pull fresh official migration information into the vector DB on demand. Bavaria/general
          uses official public sources; city names use Integreat when available.
        </p>
        <div className="mt-3">
          <label className="mb-1 block text-[11px] text-slate-500">Integreat CMS API URL</label>
          <input
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            placeholder="https://cms.integreat-app.de/<region>/<lang>/wp-json/extensions/v3/pages/"
            className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-[13px] text-charcoal outline-none focus:border-civic-purple focus:ring-2 focus:ring-civic-purple/20"
          />
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-[11px] text-slate-500">Region</label>
            <input
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="h-10 w-40 rounded-xl border border-slate-200 bg-white px-3 text-[14px] text-charcoal outline-none focus:border-civic-purple focus:ring-2 focus:ring-civic-purple/20"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-slate-500">Language</label>
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value)}
              className="h-10 w-28 rounded-xl border border-slate-200 bg-white px-3 text-[14px] text-charcoal outline-none focus:border-civic-purple focus:ring-2 focus:ring-civic-purple/20"
            >
              <option value="en">English</option>
              <option value="de">German</option>
            </select>
          </div>
          <button
            onClick={onRefresh}
            className="inline-flex h-10 items-center justify-center rounded-xl bg-civic-purple px-4 text-[14px] font-semibold text-white hover:bg-civic-purple-dark"
          >
            {apiUrl.trim() ? 'Import API URL' : 'Crawl latest'}
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-[18px] font-bold text-charcoal">Stored documents</h2>
          <div className="flex gap-2">
            <button
              onClick={onClear}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[13px] font-semibold text-charcoal hover:border-red-300 hover:text-red-600"
            >
              Clear vector DB
            </button>
            <button
              onClick={onList}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[13px] font-semibold text-charcoal hover:border-civic-purple hover:text-civic-purple"
            >
              Refresh list
            </button>
          </div>
        </div>
        {docs.length > 0 && (
          <ul className="mt-3 space-y-1">
            {docs.slice(0, 100).map((d, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-2 border-b border-slate-100 py-1.5 text-[13px]"
              >
                <span className="truncate text-charcoal">{d.metadata?.title || d.id}</span>
                <span className="shrink-0 font-mono text-[11px] text-slate-400">
                  {d.metadata?.source || d.metadata?.total || ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {status.kind !== 'idle' && (
        <div
          className="mt-4 rounded-xl border px-4 py-3 text-[13px]"
          style={{
            background:
              status.kind === 'ok'
                ? 'color-mix(in srgb, #22c55e 14%, white)'
                : status.kind === 'err'
                  ? 'color-mix(in srgb, #ef4444 12%, white)'
                  : 'color-mix(in srgb, #f59e0b 12%, white)',
            borderColor: 'var(--color-slate-200, #e2e8f0)',
            color: '#1e293b',
          }}
        >
          {status.kind === 'busy' ? '⏳ ' : status.kind === 'ok' ? '✓ ' : '⚠ '}
          {status.msg}
        </div>
      )}

      <p className="mt-6 text-center text-[12px] text-slate-400">
        <a href="/" className="underline">
          ← Back to Wegweiser
        </a>
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page shell: verify any stored token, otherwise show login.
// ---------------------------------------------------------------------------
export function AdminPage() {
  const [auth, setAuth] = useState({ status: 'checking', token: '', email: '' })

  useEffect(() => {
    const token = readToken()
    if (!token) {
      setAuth({ status: 'anon', token: '', email: '' })
      return
    }
    adminVerify(token)
      .then((me) => setAuth({ status: 'authed', token, email: me.email }))
      .catch(() => {
        writeToken('')
        setAuth({ status: 'anon', token: '', email: '' })
      })
  }, [])

  const handleAuthenticated = (token, email) => setAuth({ status: 'authed', token, email })
  const handleLogout = () => {
    writeToken('')
    setAuth({ status: 'anon', token: '', email: '' })
  }

  if (auth.status === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-white">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-civic-purple border-t-transparent" />
      </div>
    )
  }

  if (auth.status === 'authed') {
    return <AdminDashboard token={auth.token} email={auth.email} onLogout={handleLogout} />
  }

  return <LoginScreen onAuthenticated={handleAuthenticated} />
}

export default AdminPage
