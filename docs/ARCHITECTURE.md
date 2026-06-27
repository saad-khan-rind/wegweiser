# Architecture

## One picture

```
                       ┌─────────────────────────────────────────┐
                       │            apps/web  (Next.js)           │
                       │                                          │
   Personal Data ─────►│  Wallet store (localStorage / session)   │
   Wallet (on device)  │  • profile, flags, docs, progress        │
                       │  • NEVER sent as-is                       │
                       │                                          │
                       │  On-device engine (always works)         │
                       │  • journey builder                        │
                       │  • guided interview                       │
                       │  • free-form → action cards               │
                       │  • de-identify + tag derivation           │
                       └───────────────┬──────────────────────────┘
                          de-identified query + opaque tags only
                                       │ (optional)
                                       ▼
                       ┌─────────────────────────────────────────┐
                       │          apps/api  (NestJS)              │
                       │  • de-identify again (defense in depth)  │
                       │  • sanitize tags (drop free text)        │
                       │  • retrieve → compose → ground            │
                       └───────┬───────────────────────┬──────────┘
                               │                       │
                     /retrieve │                       │ chat completion
                               ▼                       ▼
                ┌──────────────────────┐   ┌────────────────────────┐
                │  apps/ai (FastAPI)   │   │  LLM provider          │
                │  RAG over Integreat  │   │  Ollama (open weights) │
                │  TF-IDF / embeddings │   │  · OpenAI · Anthropic  │
                └──────────────────────┘   │  · or grounded mock    │
                                           └────────────────────────┘
```

## Layered fallback (why the demo never breaks)

Each hop is optional. The product degrades gracefully instead of failing:

1. **No backend at all** — the web app uses its built-in engine and knowledge
   base. Full UX, on-device answers. This is what a GitHub Pages link runs.
2. **API up, Python down** — NestJS retrieves with its own keyword search over
   `kb.json`.
3. **API up, no LLM key** — NestJS returns answers composed directly from the
   retrieved sources (never invented), with action cards.
4. **Everything up** — Python RAG retrieves, the LLM phrases a 2–3 sentence
   answer strictly from those sources, low-confidence cases escalate to a human.

## Request shape

`POST /api/chat`

```json
{ "query": "where can I learn german?", "tags": ["status:asylum","region:augsburg"], "language": "en" }
```

`query` is already de-identified on the client; the server strips PII again and
drops any tag that isn't an opaque `key:value` category. Response:

```json
{
  "answer": "…2–3 sentences, grounded in sources…",
  "cards": [{ "kind": "office", "title": "Find a course near me" }],
  "sources": [{ "title": "Integration courses", "origin": "bamf", "updatedAt": "2026-06-05" }],
  "confidence": 0.88,
  "escalate": false,
  "deidentifiedQuery": "where can I learn german?",
  "provider": "ollama"
}
```

## Production integration with Integreat

This prototype is intentionally compatible with the existing stack:

- The `apps/ai` corpus is populated by `crawl.py` from Integreat's public per-region
  page API, so retrieval runs over **real, current** content.
- The de-identification mirrors the approach already in `integreat-chat`
  (the `SUMMARIZE_MESSAGE` step that strips personal details before retrieval).
- Human escalation maps onto Integreat's existing Zammad counselor hand-off.
- The journey/station model maps onto CMS pages + POIs (offices, course providers)
  already structured per region and language.

## Frontend structure

- `lib/wallet.ts` — the on-device store (local vs session for guest mode)
- `lib/privacy.ts` — de-identification, tag derivation, k-anonymity guard
- `lib/engine.ts` — journey builder, guided interview, on-device answers
- `lib/api.ts` — backend client with timeout + fallback to the engine
- `data/content.ts` — stations, journey templates, knowledge base
- `components/JourneyMap.tsx` — the signature transit-line view
- `components/StationSheet.tsx` — the boarding-pass stop detail
- `components/AnswerView.tsx` — action cards, confidence, sources, privacy receipt
