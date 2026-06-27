# Wegweiser — find your way in Germany, one step at a time

A guided, privacy-first migration assistant for the **AI for Good Hackathon** ·
Tür an Tür Digitalfabrik / Integreat challenge ("Personal Data Wallet").

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
| `apps/web` | Next.js 14 (static export), TypeScript, Tailwind | The product. Works **fully offline** via a built-in engine, so the live demo never breaks. |
| `apps/api` | NestJS 10 | Orchestration: server-side de-identification, retrieval, LLM composition. Pluggable open-weights LLM. |
| `apps/ai` | FastAPI (Python) | RAG retrieval over Integreat content (TF-IDF by default, optional multilingual embeddings). Includes an Integreat crawler. |

The three are layered with **graceful fallback**, so the demo works at every level:

```
web (on-device engine)  ──►  NestJS /api/chat  ──►  Python /retrieve  ──►  LLM
   always works              adds real RAG          adds real corpus       adds phrasing
```

If the API is down, the web app answers on-device. If the Python service is down,
the API uses its own keyword search. If no LLM is configured, the API returns
**grounded** answers straight from the sources (never invented).

---

## Quickstart

### Option A — just the demo (no backend needed)

```bash
cd apps/web
npm install
npm run dev        # http://localhost:3000
```

This is enough to show the entire experience.

### Option B — full stack with real AI

```bash
# from the repo root
cp apps/api/.env.example apps/api/.env   # optionally add an LLM key / Ollama URL
docker compose up --build
# web  http://localhost:3000
# api  http://localhost:3001/api/health
# ai   http://localhost:3002/health
```

Open-weights by default: point `OLLAMA_URL` at a running [Ollama](https://ollama.com)
(`ollama run llama3.1:8b`) and everything stays self-hosted — no third-party LLM,
as the NGO requires.

### Pull real Integreat content (optional)

```bash
cd apps/ai
python crawl.py augsburg de    # writes current region pages into ./corpus
```

---

## Deploying for the submission

**Web → GitHub Pages** (static, free, the safe demo link):

```bash
cd apps/web
NEXT_PUBLIC_BASE_PATH=/wegweiser npm run build   # use your repo name as base path
# push the apps/web/out folder to the gh-pages branch (or use the included workflow)
```

`NEXT_PUBLIC_API_URL` can point at a deployed NestJS instance (e.g. on a small VPS)
to light up real AI in the hosted demo. Leave it empty and the demo still runs on
the on-device engine.

---

## How it maps to the challenge

- **Not a chatbot** → a personalized journey map with expandable stops and action cards.
- **Very high answer accuracy** → answers are grounded in sources only; a guided,
  tappable question space keeps retrieval clean; low-confidence cases escalate to a human.
- **Current legal situation** → every source carries its origin and last-updated date,
  shown in the UI; content comes from Integreat's per-region CMS.
- **Data minimization → on device** → the wallet never leaves the phone; only
  de-identified queries + opaque tags are sent, and the app shows them to the user.
- **Open source / open weights / self-hostable** → Ollama-first LLM, local RAG,
  static frontend; no proprietary dependency required.

See `docs/ARCHITECTURE.md`, `docs/DATA_MINIMIZATION.md`, and `docs/PITCH.md`.

## License

MIT (hackathon prototype). Content snippets are illustrative; production uses
Integreat's verified CMS content.
