# Pitch — Wegweiser

5-minute pitch + 3-minute Q&A. Jury weights: **usability 40% · innovation 30% ·
pitch 30%**. Everything below is built to hit those.

---

## Slide deck (8 slides)

**1 — Title**
> Wegweiser · *find your way in Germany, one step at a time*
> A privacy-first migration guide that replaces the chatbot with a journey.
> Team · AI for Good Hackathon · Tür an Tür / Integreat track

**2 — The problem (problem understanding)**
- Newcomers don't have isolated questions; they have a **journey** through a maze
  of offices, deadlines and documents — in a language they may not read.
- A chat box puts the whole burden on the person: know what to ask, type it in a
  foreign language, and trust an AI with their most sensitive details.
- Integreat today is a great *signpost*, but it's one-directional and reactive.

**3 — The insight**
> People want a GPS for migration, not another chat window.
> And the data that makes guidance accurate is exactly the data they can't risk
> sending to a server.

**4 — The product (one screen, the transit map)**
- Pick where you are → your **personal route** appears as a transit line.
- Each stop expands: what to do, what to bring, latest official source, ≈ time.
- Free-form questions return **action cards**, not walls of text.
- A human counselor is always one tap away; low-confidence answers escalate.

**5 — The wallet (innovation: privacy by construction)**
- Your situation is a **Personal Data Wallet that never leaves your device.**
- Only de-identified queries + opaque tags (`status:asylum`, `region:bavaria`)
  are ever sent — and we **show you exactly what those are**.
- Guest mode forgets everything when you close the tab.
- Live: `…address at Goethestraße 12, 86150` → `…address at [address], [postcode]`.

**6 — Accuracy & "current legal situation"**
- Answers are **grounded in sources only** — never invented.
- Every source shows its origin (municipality / BAMF / federal) and last-updated date.
- Guided, tappable questions keep retrieval clean → higher accuracy.

**7 — Built to ship (innovation: technical execution)**
- Open weights (Ollama), local RAG, static frontend — **self-hostable, no third party.**
- Slots straight into Integreat: crawls the real per-region CMS, reuses the Zammad
  counselor hand-off, mirrors their existing de-identification.
- Safe fallback → if sources or services are weak, the assistant says so instead of guessing.

**8 — Close**
> Wegweiser turns the AI from a question box into a personal case manager —
> proactive, accurate, and private by design.
> *Find your way. Keep your data.*

---

## 5-minute script

**(0:00–0:30) Hook.** "Imagine you arrived in Germany yesterday. You don't have
one question — you have fifty, and you don't know the order. Today's tools hand
you a chat box and say 'ask me anything.' That's the wrong tool for someone who
doesn't yet know what to ask."

**(0:30–1:15) Problem.** Integreat is used in a third of German municipalities as
a signpost — but it's one-directional and reactive. And the data that would make
help truly personal — your status, your family, your documents — is exactly what
a vulnerable person can't risk uploading.

**(1:15–3:15) Demo.** (see flow below) Pick "I just arrived" → the route draws
itself. Open *Register your address* → steps, documents, the official source with
its date. Ask a free question with a fake address in it → answer comes back as
action cards, and we open the **"what leaves your device"** receipt to show the
address was stripped and only tags were sent. Tap a hard question → it escalates
to a human.

**(3:15–4:15) How it's built.** On-device wallet, opaque tags, local RAG over
uploaded documents plus current official sources, optional Gemini Flash or
open-weights Ollama, and human hand-off through their existing Zammad.
Self-hostable end to end. And it degrades gracefully: when sources are missing,
it asks instead of guessing.

**(4:15–5:00) Close.** "Wegweiser is a GPS for migration that keeps your data in
your pocket. Proactive instead of reactive, accurate because it's grounded, and
private because the sensitive part never leaves the phone. Find your way — keep
your data."

---

## Demo flow (rehearse this exact path)

1. **Onboarding** — "No account, no sign-up." Toggle **guest mode** on. Pick
   **I just arrived**.
2. **Map** — the transit line animates; "you are here" pulses on *Register your
   address*. Point out progress bar.
3. **Open a stop** — boarding-pass sheet: documents, ≈15 min, source dated June 2026.
   Tap **Explain** → action cards + confidence + sources + the privacy receipt.
   Mark it **done** → progress jumps.
4. **Ask freely** — type *"How do I get child benefit for my 2 kids at
   Goethestraße 12?"* → action cards. Open the receipt: show `[address]` stripped,
   tags `family:has_children`, `region:bavaria`.
5. **Guided** — answer one tap ("seeking asylum") → the route **re-branches** to
   the asylum line. This is the memorable moment.
6. **Escalate** — ask something legal ("my asylum was denied") → escalation card
   to a human counselor.
7. **Wallet** — show documents (one *expiring*), the exact tags that could be
   shared, and **Erase my wallet**.

> Tip: deploy the Docker stack from `RUNBOOK.md` so the web app and AI services
> use the same public API URL and the admin route is available at `/admin/`.

---

## Q&A prep (3 minutes)

- **"How is this accurate / no hallucinations?"** Answers are composed strictly
  from retrieved sources; the model is told to say when sources don't answer and
  to escalate. Sources + dates are shown. Low confidence → human.
- **"Is the data really private?"** The wallet is on-device; only de-identified
  text + opaque tags are sent, scrubbed twice (client and server), shown to the
  user. Guest mode keeps nothing. No accounts, stateless backend.
- **"Why not just a chatbot?"** A chat box assumes you know what to ask in a
  language you may not read. The map is proactive, lower-literacy friendly, and
  multilingual by tapping, not typing.
- **"How current is the legal info?"** Content is Integreat's per-region CMS,
  crawled live; every card carries a last-updated date. Counselors keep it current.
- **"Could Integreat actually adopt this?"** Yes — it reuses their content API,
  their Zammad hand-off, and their existing de-identification step; it's additive.
- **"What did you build vs. mock?"** Frontend, NestJS
  orchestration with real de-identification, and a Python RAG service over real
  content are all working. The LLM is pluggable (we demo with Ollama / a key).
