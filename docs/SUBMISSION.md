# Submission checklist (Tally — due 28.06.2026, 13:45)

https://tally.so/r/vGpMkl — you can submit multiple times; latest wins.

- [ ] **Prototype demo link** — deploy `apps/web` (GitHub Pages workflow included,
      or `cd apps/web && npm run build` then host `out/`). Make it **public**.
- [ ] **GitHub link** — push this repo, set it public.
- [ ] **Pitch video** — record the demo flow in `docs/PITCH.md` via Loom (≤ 5 min).
- [ ] **Slide deck** — build 8 slides from `docs/PITCH.md` (Google Slides / PDF), public.

### Fastest path to a working demo link
```bash
cd apps/web && npm install && npm run build   # produces apps/web/out
npx serve out                                  # verify locally
```
Then push and enable Pages (Settings → Pages → Source: GitHub Actions), and set a
repo variable `BASE_PATH=/<your-repo-name>`.

### Make the hosted demo show real AI (optional)
Deploy `apps/api` (e.g. small VPS / Render) and `apps/ai`, then set repo variable
`API_URL=https://your-api-host`. The web app will flip to "AI online".
