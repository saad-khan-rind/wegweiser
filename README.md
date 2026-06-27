# Wegweiser — find your way in Germany, one step at a time

A guided, privacy-first migration assistant for the **AI for Good Hackathon** ·
Tür an Tür Digitalfabrik / Integreat challenge ("Personal Data Wallet").

> **This version adds:** a goal-based, **self-verifying agent** that cites its
> sources and **asks instead of assuming** when information is missing; an
> **admin page** to upload documents into a **vector database (Pinecone)** used
> for RAG; an **always-latest** official-source crawler; live web retrieval; and a fix
> for the admin route/static export issue and the "AI not responding" timeout.
> **To deploy on your server, follow [`RUNBOOK.md`](./RUNBOOK.md).**

Wegweiser replaces the chatbot with a **journey you can see**. New arrivals pick
where they are; the app draws their personal route through German bureaucracy as
a **transit line**. Every stop expands into clear steps, the documents to bring,
and the latest official sources — and a human counselor is always one tap away.

The twist that makes it safe: the **Personal Data Wallet lives only on the
device**. Nothing about who you are is stored on a server. When a question needs
context, only a de-identified query plus a handful of **opaque category tags**
ever leave the phone — and the app shows you exactly what those are.

> **Why this isn't a chatbot:** people don't arrive with isolated questions, they
> arrive with a journey. Wegweiser turns the AI from a question box into a
> personal case manager that guides the process, proactively.

---

## What's in the box

| Path | Stack | Role |
|------|-------|------|
| `apps/web` | Next.js 14 (static export), TypeScript, Tailwind | The product UI, admin upload screen, and privacy receipt. |
| `apps/api` | NestJS 10 | Orchestration: server-side de-identification, admin guard, retrieval, LLM composition fallback. |
| `apps/ai` | FastAPI (Python) | Goal-based, self-verifying RAG over uploaded docs, official web content, Integreat city content, and optional live web. |

The services are layered with **safe fallback**, so the app never invents an answer:

```
web  ──►  NestJS /api/chat  ──►  Python /agent  ──►  Gemini Flash or Ollama
```

If the API or AI service is down, the UI says it cannot verify an answer right
now. If sources are weak or missing, the assistant asks a follow-up question or
recommends a counselor instead of guessing.

---

## Quickstart

### Option A — frontend only

```bash
cd apps/web
npm install
npm run dev        # http://localhost:3000
```

This shows the UI. Real answers require the API and AI service.

### Option B — full stack with real AI

```bash
# from the repo root
cp apps/api/.env.example apps/api/.env   # optionally add an LLM key / Ollama URL
cp apps/ai/.env.example apps/ai/.env     # optionally set GEMINI_API_KEY here
docker compose up --build
# web  http://localhost:3000
# api  http://localhost:3001/api/health
# ai   http://localhost:3002/health
```

Open-weights by default: point `OLLAMA_URL` at a running [Ollama](https://ollama.com)
(`ollama run llama3.1:8b`) and everything stays self-hosted. Embeddings default
to the built-in deterministic hash provider so Pinecone works even when Ollama
has no embedding model pulled. To use Gemini instead, set `GEMINI_API_KEY` in
`apps/ai/.env` (see `apps/ai/.env.example`). When that key is present, the AI
service uses `gemini-flash-latest`; when it is empty, it uses Ollama.

### Pull current official content (optional)

```bash
cd apps/ai
python crawl.py bavaria en    # writes current official pages into ./corpus
python crawl.py augsburg de   # uses Integreat for a city/region when available
```

---

## Deploying

Use the Docker setup in [`RUNBOOK.md`](./RUNBOOK.md). The static frontend is
served by the `web` container, and `/admin/` is exported as its own static route.

---

## How it maps to the challenge

- **Not a chatbot** → a personalized journey map with expandable stops and action cards.
- **Very high answer accuracy** → answers are grounded in sources only; a guided,
  tappable question space keeps retrieval clean; low-confidence cases escalate to a human.
- **Current legal situation** → every source carries its origin and last-updated date,
  shown in the UI; content comes from uploaded documents, official public sources,
  and Integreat's per-region CMS where available.
- **Data minimization → on device** → the wallet never leaves the phone; only
  de-identified queries + opaque tags are sent, and the app shows them to the user.
- **Open source / open weights / self-hostable** → Ollama by default, optional
  Gemini Flash through the AI service env, local RAG, static frontend.

See `docs/ARCHITECTURE.md`, `docs/DATA_MINIMIZATION.md`, and `docs/PITCH.md`.

## License

MIT (hackathon prototype). Content snippets are illustrative; production uses
Integreat's verified CMS content.
