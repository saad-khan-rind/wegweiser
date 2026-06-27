# RUNBOOK — running Wegweiser on your server

Three services: **web** (static UI, port 4000) → **api** (NestJS gateway, 3001) →
**ai** (Python agent + RAG, 3002) → **ollama** (LLM, 11434).

---

## Why the AI was "failing / not communicating"

Two concrete bugs, both fixed:

1. **The browser aborted every AI request after 8 seconds.** `llama3.1:8b` on CPU
   takes far longer, so every real answer was silently dropped. The client
   timeout is now 200s and configurable (`WEB_TIMEOUT_MS`).
2. **The API URL was baked in at build time** (defaulting to `localhost:3001`), so
   the visitor's browser tried to reach *their own* machine. The web app now reads
   its API URL at **runtime** from `config.js`, written from `$API_URL` when the
   container starts. No rebuild needed to change it.

Two operational must-dos (below): **pull the Ollama models**, and set **`API_URL`
to your public IP**, not `localhost` or `http://ollama`.

---

## Option A — docker compose (recommended)

```bash
# 1) optional: secrets/keys
export ADMIN_TOKEN=some-long-secret
export PINECONE_API_KEY=...        # omit to use the built-in in-memory store
# Optional: set this in apps/ai/.env to use Gemini Flash instead of Ollama
# GEMINI_API_KEY=...

# 2) build + start everything
docker compose up --build -d

# 3) pull the models INTO the ollama container (one time)
docker compose exec ollama ollama pull llama3.1:8b
docker compose exec ollama ollama pull nomic-embed-text   # for embeddings

# 4) check health
curl http://204.168.210.222:3001/api/health
```

Open `http://204.168.210.222:4000`. Admin page: `http://204.168.210.222:4000/admin/`.
To use Gemini, set `GEMINI_API_KEY` in the AI service env (`apps/ai/.env` or
your AI container environment). Leave it empty to use the current Ollama setup.
The AI service loads `apps/ai/.env` itself and does not require a frontend/admin
key setting.

`docker-compose.yml` already sets your env: `WEB_ORIGIN=http://204.168.210.222:4000`,
`OLLAMA_URL=http://ollama:11434`, `API_URL=http://204.168.210.222:3001`, web on 4000.

---

## Option B — manual `docker run` (one network, four containers)

The containers must share a network so `api → ai → ollama` resolve by name. The
browser, however, talks to **api** and **web** over your **public IP**.

```bash
docker network create wegweiser

# --- Ollama ---
docker run -d --name ollama --network wegweiser \
  -p 11434:11434 -v ollama:/root/.ollama ollama/ollama:latest
docker exec ollama ollama pull llama3.1:8b
docker exec ollama ollama pull nomic-embed-text

# --- AI (agent + RAG) ---
docker build -t wegweiser-ai ./apps/ai
docker run -d --name ai --network wegweiser \
  -e OLLAMA_URL=http://ollama:11434 \
  -e OLLAMA_MODEL=llama3.1:8b \
  -e EMBED_MODEL=nomic-embed-text \
  -e AGENT_USE_WEB=1 \
  -e CRAWL_ON_START=1 -e CRAWL_REGION=bavaria -e CRAWL_LANG=en \
  -e PINECONE_API_KEY="${PINECONE_API_KEY:-}" \
  wegweiser-ai

# --- API (gateway) ---
docker build -t wegweiser-api ./apps/api
docker run -d --name api --network wegweiser \
  -p 3001:3001 \
  -e PORT=3001 \
  -e WEB_ORIGIN=http://204.168.210.222:4000 \
  -e AI_SERVICE_URL=http://ai:3002 \
  -e AGENT_TIMEOUT_MS=200000 \
  -e ADMIN_TOKEN=some-long-secret \
  wegweiser-api

# --- Web (static UI) ---
docker build -t wegweiser-web ./apps/web
docker run -d --name web --network wegweiser \
  -p 4000:3000 \
  -e API_URL=http://204.168.210.222:3001 \
  -e WEB_TIMEOUT_MS=200000 \
  wegweiser-web
```

> **Critical:** `API_URL` and `WEB_ORIGIN` use the **public IP** (browser-reachable).
> `OLLAMA_URL` and `AI_SERVICE_URL` use **container names** (internal only).
> Open ports 4000 and 3001 in your firewall/security group.

---

## Verifying it works (diagnostics)

```bash
# API + AI + Ollama status in one call:
curl http://204.168.210.222:3001/api/health
```

Healthy output includes `"ai": { "llm": { "reachable": true,
"chat_model_present": true } , "vector_store": "pinecone|memory" }`.

If `chat_model_present` is false → run the `ollama pull` commands.
If `reachable` is false → the `ai` container can't see `ollama` (same network?).
If the browser says it cannot verify an answer, check `API_URL` is your public IP
and port 3001 is open.

Direct AI checks:
```bash
docker exec ai curl -s http://localhost:3002/health
docker exec api curl -s http://ai:3002/health   # api -> ai reachability
```

---

## Admin: upload immigrant documents

1. Go to `http://204.168.210.222:4000/admin`.
2. Enter the **admin token** (the `ADMIN_TOKEN` you set).
3. Paste text or upload a `.pdf` / `.txt` / `.md`, fill title/source/url/date.
4. The document is embedded and stored in the vector DB (Pinecone if
   `PINECONE_API_KEY` is set, otherwise in-memory). The agent retrieves it and
   **cites the source** in answers.
5. "Crawl latest" pulls fresh Integreat content for a region on demand.

---

## Pinecone (optional)

Set `PINECONE_API_KEY` (and optionally `PINECONE_INDEX`, `PINECONE_CLOUD`,
`PINECONE_REGION`) on the **ai** container. The index is created automatically
with the embedding dimension (768 for `nomic-embed-text`). Without a key, an
in-memory store is used so everything still works for a demo.

## Speed notes (CPU)

`llama3.1:8b` on CPU is slow and the agent makes a couple of LLM calls
(draft + self-verify). Expect 20–90s per answer. To speed up: use a smaller model
(`OLLAMA_MODEL=llama3.2:3b`), set `AGENT_MAX_ITERS=0`, or `AGENT_USE_WEB=0`.
