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
                       │  Test console + admin link                │
                       │  • English / German only                  │
                       │  • region + question input                │
                       │  • de-identify + tag derivation           │
                       └───────────────┬──────────────────────────┘
                          de-identified query + opaque tags only
                                       │ (optional)
                                       ▼
                       ┌─────────────────────────────────────────┐
                       │          apps/api  (NestJS)              │
                       │  • de-identify again (defense in depth)  │
                       │  • sanitize tags (drop free text)        │
                       │  • proxy chat/admin calls                 │
                       └───────┬───────────────────────┬──────────┘
                               │                       │
                  admin/chat │                       │ verified answer
                               ▼                       ▼
                ┌──────────────────────┐   ┌────────────────────────┐
                │  apps/ai (FastAPI)   │   │  LLM provider          │
                │  RAG over uploads +  │   │  Gemini Flash if key   │
                │  official web crawl  │   │  else Ollama           │
                └──────────────────────┘   │  or grounded refusal   │
                                           └────────────────────────┘
```

## Layered fallback

Each hop is handled defensively. The product refuses or asks for details instead
of inventing an answer:

1. **No backend at all** — the UI stays usable, but answers show a
   verified-unavailable state.
2. **API up, Python down** — NestJS retrieves with its own keyword search over
   `kb.json`.
3. **API up, no usable LLM** — NestJS returns a low-confidence refusal with
   sources instead of composing a shaky answer.
4. **Everything up** — Python RAG retrieves, Gemini Flash or Ollama phrases a 2-3 sentence
   answer strictly from those sources, low-confidence cases escalate to a human.

## Request shape

`POST /api/chat`

```json
{ "query": "where can I learn german?", "tags": ["status:asylum","region:bavaria"], "language": "en" }
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

- The `apps/ai` corpus is populated by admin uploads, official public URLs for
  general/Bavaria crawl, and Integreat's public per-region page API where a city
  region exists, so retrieval runs over **real, current** content.
- The de-identification mirrors the approach already in `integreat-chat`
  (the `SUMMARIZE_MESSAGE` step that strips personal details before retrieval).
- Human escalation maps onto Integreat's existing Zammad counselor hand-off.
- The journey/station model maps onto CMS pages + POIs (offices, course providers)
  already structured per region and language.

## Frontend structure

- `app/page.tsx` — live RAG test console for language, region, question, health,
  answer, citations, and verification trace
- `app/admin/page.tsx` — admin upload/crawl/status screen
- `lib/api.ts` — runtime API client with long timeout and safe fallback refusal
- `lib/privacy.ts` — de-identification, tag derivation, k-anonymity guard
- `components/AnswerView.tsx` — confidence, sources, and privacy receipt
