# CLAUDE.md

Kalima: an AI learning companion for blind and low-vision learners. It has a **website (Next.js PWA)** where users upload PDFs, and a **browser extension (WXT, MV3)** that reads the open e-learning page. Both run the same lesson workflow: explain chunk by chunk → stop / ask / continue → quiz → evaluate and correct.

- Product scope: `PROJECT.md`
- System design, API, schema, env vars: `ARCHITECTURE.md` — read it before structural changes and keep it updated when you change them.

## Stack

- pnpm + Turborepo monorepo, TypeScript everywhere (strict).
- `apps/web`: Next.js App Router, Tailwind, shadcn/ui, Serwist (PWA). **API = Next.js Route Handlers** under `app/api` (no separate backend).
- `apps/extension`: WXT + React; side panel UI, content-script page adapters.
- `packages/lesson-engine`: state machine, prompts, chunking — pure TS, no I/O.
- `packages/llm`: the only module that calls AI models (NVIDIA NIM through the `openai` SDK with `baseURL`).
- `packages/ui`: shared accessible components (`LessonPlayer`, `QuizView`…).
- `packages/speech`: Web Speech API wrappers (speak queue, listen, cancel).
- Supabase: Auth (anonymous + email OTP), Postgres + RLS, pgvector, Storage. EU region.
- Deploy: Vercel (web + API), Supabase. Nothing else.

## Commands

Run from the repo root. Secrets live in one root `.env.local` (template: `.env.example`), read by `apps/web/next.config.ts` and the llm scripts.

```
pnpm install
pnpm dev                          # all apps (turbo)
pnpm --filter web dev             # website + API on http://localhost:3000
pnpm --filter extension dev       # extension with HMR (opens Chromium)
pnpm --filter extension build     # → apps/extension/.output/chrome-mv3 (load unpacked)
pnpm --filter extension zip       # zip for sharing
pnpm test                         # vitest (all packages)
pnpm typecheck                    # tsc (web runs `next typegen` first)
pnpm lint
pnpm --filter llm smoke           # live AI check through the chain (text + image + stream)
pnpm --filter llm smoke -- --each # same, each provider on its own
curl localhost:3000/api/health    # which providers / Supabase the server sees (names only)
pnpm --filter web seed            # DEV: full workflow through the API (dev server must run); add `-- --lang fr`
pnpm --filter web rls-check       # DEV: after seed — a second user must get 404 on the seed user's data
pnpm --filter web page-check <payload.json>  # DEV: extension backend path (CORS → from-page → cache → explain)
pnpm --filter web dev-session     # DEV: test-user session JSON for browser tests (while anonymous sign-in is off)
```

Database: migrations in `supabase/migrations/` are applied with the Supabase MCP (`apply_migration`), then `get_advisors` (security) must be clean and the types regenerated into `apps/web/lib/database.types.ts`.

Windows note: write files as UTF-8 **without BOM** (PowerShell 5.1 `Set-Content -Encoding utf8` adds one and breaks Turbo's YAML parsing).

## Rules

### AI calls
- Provider chain: **NVIDIA → Groq → OpenRouter**. Each provider gets **3 attempts** with backoff before falling to the next (details in `ARCHITECTURE.md` §5). Never bypass the chain.
- Call models **only** through `packages/llm`. Never import `openai` elsewhere, and never hard-code a model ID — read it from `NV_MODEL_*` env vars.
- Prompts live in `packages/lesson-engine/src/prompts/`, one file per task (explain, ask, plan, quiz, evaluate, describe-image), with FR and EN variants.
- Anything the code parses (plan, quiz, evaluation) must come back as JSON validated with **zod**; retry once on invalid output.
- Stream every user-facing text response (SSE). The client speaks sentence by sentence.
- Q&A answers must be grounded in the course chunks. If the answer isn't in the course, say so, then give general knowledge clearly labelled as such.

### Accessibility (non-negotiable — this is the product)
- WCAG 2.2 AA. Every feature must be usable **keyboard-only** and by **voice**; never mouse-only, never color-only.
- Use semantic HTML first, ARIA only when needed. Announce status changes through `aria-live` regions.
- Visible focus rings; nothing may trap focus; logical tab order; 200% zoom must not break layout.
- Only one voice at a time: all speech goes through the `packages/speech` queue, and any user action cancels current speech instantly.
- New UI must pass an axe check and a manual keyboard-only run-through before it counts as done.
- Keep UI copy short, in FR and EN (i18n keys, no hard-coded strings in components).
- **Colors:** light mode, primary green `#15803D`, white background, secondary red `#B91C1C`. Use only the CSS variable tokens from `ARCHITECTURE.md` §8b — never raw hex in components. Red = stop / errors / wrong answers; green = primary actions / correct / progress. Never convey meaning by color alone: always pair it with an icon + text.

### Security & privacy
- `NVIDIA_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are **server-only**. Never reference them in client components, `NEXT_PUBLIC_*` variables or the extension.
- Every user table has RLS. New tables ship with policies in the same migration.
- Files are uploaded directly to Supabase Storage via signed URLs, never through an API route (Vercel body limit).
- Analytics (`usage_events`) is anonymous: no names, emails or course content.

### Code
- Schema changes only go through new files in `supabase/migrations/`; never edit an applied migration.
- Lesson state transitions are pure functions in `lesson-engine`, and each new transition needs a unit test.
- Route handlers that stream or call models: `export const runtime = 'nodejs'` + explicit `maxDuration`.
- Long work (PDF ingestion) is split into resumable batches that save progress in the DB; don't write one giant request.
- Extension page extraction is `apps/extension/lib/extract.ts` → `extractPage()`. It is injected with `chrome.scripting.executeScript({ func })`, so it **must stay self-contained** (no imports, no outer variables). Platform adapters (Moodle, Coursera, Classroom) are branches inside it that pick the content root. Always keep the generic path and the "too little text → whole visible text" fallback working.
- The extension side panel reuses `<LessonPlayer/>` through its own `LessonApi` (`apps/extension/lib/api.ts`). Never fork the player.
- Keep it simple: this is a hackathon MVP. Prefer fewer files and fewer dependencies, and don't abstract early.
