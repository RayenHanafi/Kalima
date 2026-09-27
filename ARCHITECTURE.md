# Kalima — Architecture

> Everything deploys to **Vercel** (web app + API) and **Supabase** (auth, database, storage, vectors). AI runs on **NVIDIA NIM** hosted APIs. No other servers.

---

## 1. System overview

```
┌──────────────────────────┐        ┌──────────────────────────┐
│  Website (Next.js PWA)   │        │  Browser extension (WXT) │
│  - PDF upload            │        │  - content script: reads │
│  - Lesson player UI      │        │    the open page         │
│  - Web Speech (STT/TTS)  │        │  - side panel: same      │
│                          │        │    Lesson player UI      │
└────────────┬─────────────┘        └────────────┬─────────────┘
             │  HTTPS + SSE (streaming)          │
             ▼                                   ▼
┌──────────────────────────────────────────────────────────────┐
│  Vercel — Next.js Route Handlers (/api/*)  = the backend      │
│  ingest · plan · explain · ask · quiz · evaluate · describe   │
│  uses packages/lesson-engine + packages/llm                   │
└───────────────┬───────────────────────────────┬──────────────┘
                │                               │
                ▼                               ▼
┌───────────────────────────────┐   ┌───────────────────────────┐
│  NVIDIA NIM (hosted APIs)     │   │  Supabase (EU region)     │
│  LLM · VLM · OCR · embeddings │   │  Auth · Postgres · RLS    │
│  (OpenAI-compatible)          │   │  pgvector · Storage       │
└───────────────────────────────┘   └───────────────────────────┘
```

**Key principle:** the website and the extension are only **two input adapters** in front of the same **lesson engine**. The workflow, prompts, API, player UI and data model are shared.

## 2. Repository layout (pnpm + Turborepo monorepo)

```
Kalima/
├─ apps/
│  ├─ web/                  Next.js (App Router) — PWA + all API routes
│  │  ├─ app/               pages: /, /upload, /course/[id], /dashboard
│  │  ├─ app/api/           route handlers (the backend, §6)
│  │  └─ lib/               supabase server client, auth helpers
│  └─ extension/            WXT (Manifest V3), React side panel
│     ├─ entrypoints/
│     │  ├─ content.ts      page extraction (platform adapters)
│     │  ├─ background.ts   commands, image fetching, messaging
│     │  └─ sidepanel/      mounts <LessonPlayer/> from packages/ui
│     └─ adapters/          moodle.ts, coursera.ts, classroom.ts, canvas.ts, generic.ts
├─ packages/
│  ├─ lesson-engine/        state machine, types, prompts, chunking (pure TS, no I/O)
│  ├─ llm/                  NVIDIA NIM client wrapper (the ONLY place that calls models)
│  ├─ ui/                   shared accessible React components (LessonPlayer, QuizView…)
│  └─ speech/               Web Speech wrappers: speak queue, listen, cancel
├─ supabase/
│  └─ migrations/           SQL migrations (schema, RLS, pgvector)
├─ PROJECT.md  ARCHITECTURE.md  CLAUDE.md
└─ turbo.json  pnpm-workspace.yaml
```

## 3. Lesson engine (shared state machine)

```
            ┌──────────┐   ┌────────┐   ┌───────────┐
 start ───► │ INGESTING│──►│PLANNING│──►│ EXPLAINING│◄───────────────┐
            └──────────┘   └────────┘   └─────┬─────┘                │
                                          stop│  ▲ continue          │
                                              ▼  │                   │
                                        ┌──────────┐   ask   ┌──────────────┐
                                        │  PAUSED  │───────► │  ANSWERING   │
                                        └──────────┘◄─────── └──────────────┘
                                              │ (all chunks done)
                                              ▼
                                        ┌──────────┐  submit ┌──────────────┐
                                        │   QUIZ   │───────► │  EVALUATED   │
                                        └──────────┘         └──────┬───────┘
                                                                    │ review mistakes
                                                                    ▼
                                                    EXPLAINING (only weak chunks) ─► DONE
```

- State lives in `lesson_sessions` (DB) + client memory. The DB is the source of truth for resume.
- **Position = `current_chunk_idx` + `sentence_offset`.** Stop cancels speech immediately (`speechSynthesis.cancel()`) and aborts the stream (`AbortController`); continue restarts from the saved sentence.
- **Prefetch:** while chunk *n* is being spoken, the client requests the explanation for chunk *n+1*, so there's no gap between chunks.
- Transitions are pure functions in `packages/lesson-engine` (`next(state, event) → state`) and are unit-tested.

## 4. Data flows

### 4.1 Website — PDF ingestion

Vercel functions cap request bodies at ~4.5 MB, so **files never go through the API**.

1. Client `POST /api/courses` → creates the `courses` row and returns a **Supabase signed upload URL**.
2. Client uploads the PDF **directly to Supabase Storage**.
3. Client renders page thumbnails with **pdf.js in the browser** (no native canvas on serverless) and uploads the PNGs of pages that contain figures or have no text layer.
4. Client calls `POST /api/courses/:id/ingest?from=0&to=9` **in page batches** (resumable, each call well under the function time limit):
   - text layer extracted server-side (`unpdf`);
   - pages without text → page image to Nemotron Omni (reads scanned pages);
   - figures → VLM description (cached by image hash);
   - result → rows in `course_pages` (one per page; `courses.pages_done` tracks progress).
5. `POST /api/courses/:id/plan` → LLM turns the raw content into ordered teachable **chunks** (JSON, structured output) + embeddings → `chunks`.
6. `courses.status = 'ready'` → the player starts.

### 4.2 Extension — page ingestion

1. User triggers Kalima (shortcut / toolbar / side panel).
2. The content script detects the platform (URL + DOM signature) and runs the matching adapter; otherwise **generic** (`@mozilla/readability` + heading / figure walk).
3. Adapter output: `{ platform, url, title, sections[{heading, html_text}], images[{src, alt, nearby_text}], quiz? }`.
4. Images are fetched by the background worker (host permissions avoid CORS), downscaled, sent as base64.
5. `POST /api/courses/from-page` → same planning pipeline as 4.1 step 5 → same player.
6. Cache key = normalised URL + content hash, so reopening the same lesson is instant.

### 4.3 Explain / Ask / Quiz

| Step | Endpoint | Model input | Output |
|---|---|---|---|
| Explain chunk | `POST /api/sessions/:id/explain` (SSE) | chunk + course outline + learner language/level | streamed teaching text; the client speaks it sentence by sentence |
| Ask | `POST /api/sessions/:id/ask` (SSE) | question + current chunk + the full course text (MVP, no retrieval) | streamed answer grounded in the course, citing the part; off-course questions are labelled |
| Generate quiz | `POST /api/sessions/:id/quiz` | all chunks explained | JSON: 5–10 questions (MCQ / true-false / short answer), each with `chunk_id` |
| Evaluate | `POST /api/quizzes/:id/submit` | questions + learner answers | JSON: per-question `correct`, `explanation`, `correct_answer`; `weak_chunk_ids`; score |
| Review | `explain` with `mode=review` | weak chunks + the learner's wrong answers | targeted re-explanation |

Streaming: route handlers return a `ReadableStream` (`text/event-stream`, helper `apps/web/lib/sse.ts`) that forwards the model's tokens. Mark them `export const runtime = 'nodejs'` and set `maxDuration`.

**SSE protocol** (explain / ask):
- `event: delta` with `data: {"text": "..."}`: the next piece of text.
- `event: done` with `data: {chunkIdx, chunkId, mode, title, cached, provider}`: finished.
- `event: error` with `data: {error: "ai_unavailable"|"stream_interrupted"|"internal_error", midStream}`: if `midStream` is true, some text was already sent, so the client resumes from its last spoken sentence.

**Planning never rewrites the course.** The server cuts pages into numbered blocks (`toBlocks`). The model only returns block *ranges* + titles, and `assembleChunks` repairs gaps and overlaps. So chunk content is always the course's own words, and the model's output stays small.

**Quiz answers never leave the server.** `POST .../quiz` returns questions without `answer`. Grading (`POST /api/quizzes/:id/submit`) resolves spoken or typed choices in code (`gradeChoice`: "B", "option b", "2", "vrai", or the option text). The model grades short answers and writes explanations. If every AI provider is down, the choice grades still come back.

**Auth:** every route requires `Authorization: Bearer <Supabase access token>` (verified with `getClaims`) and queries **as the user**, through RLS. Another user's ids return 404; `pnpm --filter web rls-check` verifies this. The service role is used only to write `image_descriptions`.

**Image fetches** (`describe-image` with a URL): public `https:` hostnames only (no IP literals, localhost or internal TLDs), no redirects, 10 s timeout, max 5 MB, image types only.

## 5. AI models (NVIDIA NIM)

All calls go through `packages/llm`. NIM chat, vision and embedding endpoints are **OpenAI-compatible**, so we use the `openai` npm SDK with `baseURL = https://integrate.api.nvidia.com/v1`. Models are selected **only by env vars**, so swapping a model needs no code change.

**Chosen main model: `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning`** (released 2026-04-28).
- Omni-modal: text, image, video and audio in, text out.
- 30B-parameter MoE with 3B active, so it's fast.
- Long context (~256K–300K).
- Reasoning controlled by `reasoning_budget` (max 16384); the reference example uses `temperature 0.6`, `top_p 0.95`.

One model covers teaching, Q&A, quiz, grading, image / chart description and scanned-page reading.

| Role | Env var | Model |
|---|---|---|
| Teaching, Q&A, quiz, grading | `NV_MODEL_TEXT` | `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` |
| Image / chart / diagram description, scanned pages | `NV_MODEL_VISION` | `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` (same model; page images sent as `image_url`) |
| Embeddings for Q&A retrieval | `NV_MODEL_EMBED` | NVIDIA embedding model from build.nvidia.com (TBD; set `EMBED_DIM` in the migration to match) |
| Rerank (optional) | `NV_MODEL_RERANK` | NVIDIA reranker (optional) |
| Speech (optional, later) | — | Omni accepts audio input (could transcribe questions); Magpie (TTS) via Riva |

**Cost: free for the hackathon.**
- **Primary:** NVIDIA build.nvidia.com free developer tier. About 1,000 credits and ~40 requests/min, no card needed.
- **Fallback:** OpenRouter `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`. 20 requests/min and 50/day (1,000/day after a one-time $10 top-up); it may 429 when the provider is busy.
- **Other free fallbacks** (the team is fine with non-NVIDIA models):
  - **Groq** (very fast; e.g. `qwen/qwen3.8-27b` with vision, ~30 RPM / 1,000 per day; `whisper-large-v3-turbo` for free speech-to-text);
  - **Google Gemini Flash** free tier (native PDF, images and audio, huge context). Its free-tier prompts may be used by Google to improve its products, so warn users.
- All of these are OpenAI-compatible.

**Retry and fallback policy** (implemented in `packages/llm`):
- **Order:** NVIDIA → Groq → OpenRouter, from `LLM_PROVIDERS=nvidia,groq,openrouter`.
- **Each provider gets 3 attempts** with exponential backoff (~0.5 s, 1 s, 2 s; honor `Retry-After` when present) before moving on to the next provider.
- **Retryable:** 429, 5xx, timeouts and network errors. **Not retryable:** 400 / 401 / 403 / 404 (log it and move straight to the next provider).
- Providers with no API key set are skipped.
- **Streaming:** if a stream fails *before* the first token, retry or fall back. If it fails mid-stream, surface an error event; the client resumes from the last spoken sentence.
- Each call logs `{provider, model, attempt, latency_ms, ok}` (no content) for debugging and the impact report.
- **Junk output** (empty, or `<unk>` runs — seen live from NVIDIA on an image request) counts as a retryable failure.
- **Per-attempt timeouts:** 90 s for `chat()`, 30 s to the first visible token for `chatStream()`. A `Retry-After` longer than 8 s skips straight to the next provider.
- **Reasoning control (verified live):** NVIDIA `chat_template_kwargs.enable_thinking=false` (off) or `reasoning_budget` (low / high); Groq Qwen `reasoning_effort: none|default`; OpenRouter `reasoning: {enabled:false}` or `{max_tokens}`.

**Measured on 2026-09-27** (`pnpm --filter llm smoke -- --each`):

| Provider | Text | Image (chart) | Stream, first token | Notes |
|---|---|---|---|---|
| NVIDIA Nemotron Omni | ~1.1 s | 1.8–2.8 s | ~0.3 s | Free tier often returns 503 "ResourceExhausted"; the retries cover it |
| Groq `qwen/qwen3.8-27b` | ~0.6 s | ~0.6 s, most accurate values | ~0.25 s | Llama 4 Scout is no longer on Groq |
| OpenRouter Nemotron `:free` | ~1.4 s | ~3 s (after 2 retries) | ~0.45 s | 50 requests/day |

**Budget:** one full lesson ≈ 20–25 requests (plan 1, explain ~10, ask ~3, describe images ~5, quiz 1, evaluate 1). Cache every model output in the DB, and pre-process the demo course so the live demo mostly replays cached results.

**MVP simplification:** a whole course fits in the ~256K context. For Q&A, send the full course text instead of doing retrieval, so no embedding model or pgvector is needed at first. Add retrieval only if a course is too long.

**Reasoning per task** (`TASK_REASONING` in `packages/lesson-engine`, tuned on real runs on 2026-09-27):

| Task | Reasoning | Measured (NVIDIA) | Why |
|---|---|---|---|
| Explain / review | off | first words ~2 s | With `low`, the first word took ~20 s (thinking time) |
| Ask | off | first words ~0.7 s | Same |
| Describe image | off | ~1–3 s | `low` took 28 s |
| Evaluate | off | ~7 s | Multiple choice / true-false are graded in code; the model only writes explanations |
| Quiz | off | 7–13 s | `low` took ~35 s; answers are validated and normalized in code |
| Plan | low | ~26 s (2 pages) | Structure matters; runs during upload, with progress shown |

Reasoning text is stripped server-side; only the final answer is streamed and spoken.
NVIDIA's free tier sometimes sends "ResourceExhausted" *inside* the stream (not as an HTTP 503); the chain treats it as retryable.

**Speech default:** browser **Web Speech API** (`SpeechRecognition` + `speechSynthesis`). It's free and instant, runs on the device (GDPR-friendly) and supports FR/EN. Riva is an upgrade path.

**Latency budget (target < 5 s to first spoken word):** streaming + speak-on-first-sentence + prefetch of next chunk + description cache by image hash.

## 6. API (Next.js Route Handlers, `apps/web/app/api`)

| Method & path | Purpose |
|---|---|
| `POST /api/courses` | Create a course from a PDF → signed upload URL |
| `POST /api/courses/:id/ingest` | Process one page batch (resumable) |
| `POST /api/courses/from-page` | Create a course from an extension page payload |
| `POST /api/courses/:id/plan` | Build chunks + embeddings |
| `GET  /api/courses/:id` | Course + chunks + status |
| `POST /api/sessions` | Start / resume a lesson session |
| `PATCH /api/sessions/:id` | Save state (`status`, `current_chunk_idx`, `sentence_offset`) |
| `POST /api/sessions/:id/explain` | SSE — explain one chunk (`mode=normal|review`) |
| `POST /api/sessions/:id/ask` | SSE — answer a question |
| `POST /api/sessions/:id/quiz` | Generate the quiz |
| `POST /api/quizzes/:id/submit` | Grade + correct |
| `POST /api/describe-image` | Describe one image (short / detailed), cached |
| `POST /api/events` | Anonymised usage event |

Auth: the Supabase JWT in `Authorization: Bearer` (the extension stores the session in `chrome.storage.session`). Frictionless demo: **Supabase anonymous sign-in**, upgradeable to email OTP.

CORS: allow the extension origin `chrome-extension://<EXTENSION_ID>` on `/api/*`.

## 7. Data model (Supabase Postgres)

```sql
profiles        (id uuid pk = auth.uid, locale text, voice text, rate real, detail_level text)
courses         (id uuid pk, user_id uuid, source_type text check in ('pdf','web'),
                 title text, source_url text, storage_path text, platform text,
                 lang text, content_hash text, status text, created_at timestamptz)
course_pages    (course_id uuid, page_no int, text text, image_path text,
                 figure_descriptions jsonb, pk (course_id, page_no))   -- raw ingestion, resumable
chunks          (id uuid pk, course_id uuid, idx int, title text, content text,
                 figure_descriptions jsonb, page_ref text)   -- embedding column added only if retrieval is needed
image_descriptions (image_hash text, lang text, short text, detailed text, model text,
                 pk (image_hash, lang))
lesson_sessions (id uuid pk, course_id uuid, user_id uuid, status text,
                 current_chunk_idx int, sentence_offset int, updated_at timestamptz)
messages        (id uuid pk, session_id uuid, role text, kind text, chunk_idx int,
                 content text, created_at timestamptz)
quizzes         (id uuid pk, session_id uuid, questions jsonb, created_at timestamptz)
quiz_attempts   (id uuid pk, quiz_id uuid, answers jsonb, results jsonb, score real,
                 weak_chunk_ids uuid[], created_at timestamptz)
usage_events    (id bigserial, anon_id text, event text, platform text,
                 duration_ms int, meta jsonb, created_at timestamptz)
```

- **RLS on every user table:** `user_id = auth.uid()` (chunks / quizzes are reached through their course / session).
- `image_descriptions` is shared (no PII) — read by anyone, written by the service role only.
- Storage bucket `course-files` (private); a scheduled job deletes files older than N days.
- `usage_events` has an explicit restrictive deny-all policy for `anon` / `authenticated`: only the service role touches it.
- Vector search (later, only if needed): SQL function `match_chunks(course_id, query_embedding, k)`.
- Applied migrations: `0001_init`, `0002_usage_events_deny_clients`. Security advisor: 0 findings.

## 8. Accessibility architecture

- A single `<LessonPlayer/>` (packages/ui) used by the web app and the side panel. It's built accessible once:
  - live regions (`aria-live="polite"`) for status and for the current sentence;
  - visible focus, 200% zoom safe, high-contrast theme, reduced motion;
  - every control has a keyboard path and a voice path.
- Speech never overlaps: one global speak queue in `packages/speech`; any user input cancels it.
- If the user's own screen reader is active, offer a "screen-reader mode": Kalima writes to a live region instead of using TTS, to avoid two voices.

## 8b. Visual design (light mode)

**Primary green, white background, red secondary.** Every pair below was checked against WCAG 2.2 AA (text ≥ 4.5:1, UI parts ≥ 3:1).

| Token | Hex | Use | Contrast |
|---|---|---|---|
| `--bg` | `#FFFFFF` | page background | — |
| `--surface` | `#F0FDF4` | cards, player panel (green tint) | — |
| `--text` | `#111827` | body text | 17.7:1 on white |
| `--text-muted` | `#4B5563` | secondary text | 7.6:1 |
| `--primary` | `#15803D` | primary buttons (white text), progress, "correct" | 5.0:1 (white on it) |
| `--primary-hover` | `#166534` | hover / pressed | 7.1:1 |
| `--primary-strong` | `#14532D` | links, headings, **focus ring** | 9.1:1 |
| `--secondary` | `#B91C1C` | **Stop** button, errors, "wrong answer", destructive actions | 6.5:1 (white on it) |
| `--secondary-hover` | `#991B1B` | hover / pressed | 8.3:1 |
| `--secondary-tint` | `#FEF2F2` | error / mistake panels | red text 5.9:1 on it |
| `--border` | `#6B7280` | input and control borders | 4.8:1 |

**Rules:**
- **Never rely on green vs red alone.** Red-green color blindness is the most common kind, and many of our users are low-vision. "Correct" and "wrong" always carry an icon (✓ / ✗) **and** a text label ("Correct" / "Incorrect").
- Focus ring: 3px solid `--primary-strong` with a 2px offset, on every focusable element.
- Minimum text size is 18px for the player. Big targets (≥ 44×44px). A high-contrast theme and text-size controls are available in settings.
- Only light mode is required. Keep the tokens as CSS variables so a dark or high-contrast theme can be added later without touching components.

## 9. Deployment

| Piece | Where | Notes |
|---|---|---|
| Web + API | **Vercel** (`apps/web`) | Git-connected; preview deploy per PR; env vars in the Vercel project |
| DB / Auth / Storage | **Supabase** project `Kalima` (ref `hgqwynzyveizfssjtjxn`, eu-west-1) | Migrations in `supabase/migrations`, applied via the Supabase CLI / MCP |
| Extension | Unpacked `.zip` for the demo | Chrome Web Store submission in parallel (review takes days) |
| AI | NVIDIA NIM hosted | API key from build.nvidia.com, **server-side only** |

### Environment variables (`apps/web`)

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=        # server only
NVIDIA_API_KEY=                   # server only
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
OPENROUTER_API_KEY=               # server only, fallback
OPENROUTER_MODEL=nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free
GROQ_API_KEY=                     # server only, fallback
GROQ_MODEL=qwen/qwen3.8-27b
LLM_PROVIDERS=nvidia,groq,openrouter   # tried in order
NV_MODEL_TEXT=nvidia/nemotron-3-nano-omni-30b-a3b-reasoning
NV_MODEL_VISION=nvidia/nemotron-3-nano-omni-30b-a3b-reasoning
NV_MODEL_EMBED=
NV_MODEL_RERANK=
EXTENSION_ORIGIN=chrome-extension://<id>
```

The extension only knows `API_BASE_URL` and the Supabase anon key. **Never ship `NVIDIA_API_KEY` or the service-role key to the client or the extension.**

## 10. Build order

1. Monorepo scaffold, Supabase schema + RLS, `packages/llm` smoke test against NIM.
2. `lesson-engine` state machine + prompts (explain / ask / quiz / evaluate) with unit tests.
3. Website: upload → ingest → plan → `<LessonPlayer/>` with streaming TTS and stop / ask / continue.
4. Quiz → evaluate → review loop.
5. Extension: generic adapter + side panel reusing `<LessonPlayer/>`, then the Moodle adapter, then the second platform.
6. PWA (Serwist), accessibility pass (axe + keyboard-only + NVDA test), analytics events.
7. Demo polish, impact metrics, video.
