# Kalima

**Kalima turns any course — a PDF or an e-learning page — into a spoken, interactive lesson for blind and low-vision learners.**
Hackathon project · GOMYCODE "Build with AI" · 2026

Kalima reads the course, describes its images and diagrams, and explains it out loud, part by part. The learner can stop at any moment, ask a question by voice or keyboard, then continue. At the end, a short quiz checks understanding, corrects each mistake and re-explains what was missed.

- **Website (installable app):** upload a PDF → spoken lesson → questions → quiz → review. The PDF never leaves the device: only its text and pictures of pages with figures are sent.
- **Browser extension (Chrome / Edge):** on any course page (Moodle, Coursera, Classroom, Wikipedia…), press **Alt+Shift+K**. Kalima reads the page and runs the same lesson in the side panel.
- **Accessible by design:** keyboard only or voice; WCAG 2.2 AA (axe: 0 violations); Atkinson Hyperlegible font; green/white/red theme with every color pair checked for contrast; "correct" / "incorrect" never shown by color alone.
- **French and English**, including an English course taught to a French learner.

## Keyboard & voice

| Action | Key | Voice (press **V**, then speak) |
|---|---|---|
| Pause / continue | Space | « stop » / « continue » |
| Ask a question | Q | « question … » |
| Repeat the part | R | « répète » / "repeat" |
| Next / previous part | N / P | « suivant » / « précédent » |
| Quiz answers | 1–4 or A–D, Enter | say the answer |
| Help | ? | |

## How it works

```
Website (Next.js PWA) ─┐                          ┌─► NVIDIA NIM (Nemotron 3 Nano Omni)
                        ├─► Next.js API on Vercel ─┼─► Groq (Qwen 3.8) fallback
Chrome extension (WXT) ─┘   (lesson engine)        ├─► OpenRouter fallback
                                                    └─► Supabase (Auth, Postgres + RLS, EU)
```

- **Lesson engine** (`packages/lesson-engine`): a pure state machine (explain ⇄ pause ⇄ ask → quiz → evaluate → review) plus the FR/EN prompts. Planning never rewrites the course: the model only chooses how to split it into parts.
- **AI chain** (`packages/llm`): NVIDIA → Groq → OpenRouter, 3 attempts each with backoff. Garbage-output detection. Reasoning is tuned per task, so the first spoken words arrive in ~1–3 s.
- **Player** (`packages/ui`): one accessible `<LessonPlayer/>`, shared by the website and the extension.
- **Impact** (`/dashboard`): anonymous indicators (sessions, completion, questions, quiz scores, time to first word).

Details: [`PROJECT.md`](PROJECT.md) (product) · [`ARCHITECTURE.md`](ARCHITECTURE.md) (system) · [`CLAUDE.md`](CLAUDE.md) (conventions).

## Run locally

Requirements: Node 22, pnpm.

```bash
pnpm install
cp .env.example .env.local        # fill in the keys (NVIDIA, Groq, OpenRouter, Supabase)
pnpm --filter web dev             # http://localhost:3000
```

In Supabase, turn on **Authentication → Sign In / Providers → Allow anonymous sign-ins**, so learners never need an account.

### Extension

```bash
pnpm --filter extension build                                          # API = http://localhost:3000
KALIMA_API_BASE_URL=https://<your-deployment> pnpm --filter extension zip  # production build
```

Then in Chrome: open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and choose `apps/extension/.output/chrome-mv3`.

### Checks

```bash
pnpm test && pnpm typecheck && pnpm lint
pnpm --filter llm smoke -- --each   # live AI providers
pnpm --filter web seed              # full lesson through the API (dev server running)
pnpm --filter web rls-check         # a second user cannot see the first user's data
```
