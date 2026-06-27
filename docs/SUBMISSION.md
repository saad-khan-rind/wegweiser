# Submission checklist (Tally — due 28.06.2026, 13:45)

https://tally.so/r/vGpMkl — you can submit multiple times; latest wins.

- [ ] **Prototype demo link** — deploy the Docker stack from `RUNBOOK.md`. Make it **public**.
- [ ] **GitHub link** — push this repo, set it public.
- [ ] **Pitch video** — record the demo flow in `docs/PITCH.md` via Loom (≤ 5 min).
- [ ] **Slide deck** — build 8 slides from `docs/PITCH.md` (Google Slides / PDF), public.

### Fastest path to a working demo link
```bash
cd apps/web && npm install && npm run build   # produces apps/web/out
npx serve out                                  # verify locally
```
Then deploy it with the web container from `RUNBOOK.md`.

### Make the hosted demo show real AI (optional)
Deploy `apps/api` and `apps/ai` from the Docker stack and set the web container's
`API_URL` to the public API URL. The web app will flip to "AI online".
