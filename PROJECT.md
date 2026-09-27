# Kalima — Project Brief

> AI learning companion that turns any course (PDF or e-learning page) into a spoken, interactive lesson for blind and low-vision learners.
> Hackathon: GOMYCODE — Build with AI · Cahier des charges v1.0 (Sept 2026)

---

## 1. Problem

E-learning platforms (Moodle, Coursera, Google Classroom, Canvas…) and course PDFs are largely inaccessible to blind and low-vision learners:

- Images, diagrams, charts, equations and slides have no useful description.
- Complex interfaces confuse screen readers.
- Quizzes are hard or impossible to use with keyboard / voice.
- PDFs and slide decks are often unreadable.

Existing tools (Be My Eyes, Seeing AI, Ally, Helperbird…) are partial. None offers a **learner-controlled, voice-first, pedagogy-aware** experience.

**Social goal:** let visually impaired learners follow the same courses as everyone else — autonomously and with dignity.

## 2. Users

| Primary | Secondary |
|---|---|
| Blind / low-vision students, trainees, people in reconversion, lifelong learners | Visual-impairment associations, university disability services, training organisations |

## 3. Product (mandatory scope)

Kalima has **two entry points** that share **one lesson workflow**:

| Entry point | Input | How content is obtained |
|---|---|---|
| **Website (PWA)** | User uploads a PDF | PDF → text + figures → course chunks |
| **Browser extension** | The e-learning page currently open | Page DOM → structured content + images → course chunks |

### 3.1 The lesson workflow (identical in both modes)

```
INGEST ─► PLAN ─► EXPLAIN chunk 1 … chunk N ─► QUIZ ─► EVALUATE ─► REVIEW mistakes
                     │   ▲
                STOP │   │ CONTINUE
                     ▼   │
                   Q&A (ask anything about the course, answered from the course)
```

1. **Ingest** — read the whole course (text, headings, images, tables, equations).
2. **Plan** — split it into an ordered list of short, teachable chunks.
3. **Explain** — the AI explains the course chunk by chunk, spoken aloud (and shown as large text). Visuals are described in context.
4. **Stop → Ask → Continue** — at any moment the learner presses stop (button, keyboard shortcut or voice), asks a question by voice or text, gets an answer grounded in the course, then resumes exactly where they left off.
5. **Quiz** — at the end, Kalima proposes a quiz on what was explained.
6. **Evaluate & correct** — answers are graded; each mistake gets an explanation of *why* and the correct answer.
7. **Review** — Kalima offers to re-explain the chunks linked to wrong answers.

Progress is saved: the learner can close and resume later.

## 4. Features

### MVP (must ship)

| # | Feature | Website | Extension |
|---|---|:-:|:-:|
| F1 | PDF upload + ingestion (text, figures, scanned pages via OCR) | ✅ | — |
| F2 | Page reading: platform detection (Moodle, Coursera, Classroom, Canvas) + generic fallback | — | ✅ |
| F3 | Course planning into chunks | ✅ | ✅ |
| F4 | Streaming spoken explanation, chunk by chunk | ✅ | ✅ |
| F5 | Contextual description of images / charts / diagrams / equations | ✅ | ✅ |
| F6 | Stop / continue — button, keyboard shortcut, voice | ✅ | ✅ |
| F7 | Q&A grounded in the course (voice or text) | ✅ | ✅ |
| F8 | End-of-course quiz (voice or keyboard answers) | ✅ | ✅ |
| F9 | Evaluation + correction of mistakes + targeted re-explanation | ✅ | ✅ |
| F10 | Resume where you left off | ✅ | ✅ |
| F11 | French + English | ✅ | ✅ |
| F12 | Fully accessible UI (WCAG 2.2 AA, keyboard-only, screen-reader friendly) | ✅ | ✅ |

### Nice to have (post-MVP, only if time allows)

- Voice commands beyond stop/continue ("next section", "repeat", "describe this chart in detail", "what's my progress?").
- Course summary at the end / on demand.
- Help with quizzes that are already on the e-learning page (read the question and options, answer by voice).
- Better STEM support (equations spoken naturally, chart trends and values).
- Personal library of past courses.
- Adjustable voice, speed and level of detail.
- Partner dashboard with anonymised usage (feeds the social-impact indicators).
- Offline mode for already-processed courses (PWA cache).

## 5. Voice & keyboard controls (MVP)

| Action | Keyboard (web / side panel) | Voice (FR / EN) |
|---|---|---|
| Pause / resume | `Space` | « stop » / « continue » · "stop" / "continue" |
| Ask a question | `Q` | « question » · "question" |
| Repeat current chunk | `R` | « répète » · "repeat" |
| Next / previous chunk | `N` / `P` | « suivant » / « précédent » · "next" / "previous" |
| More detail on the visual | `D` | « décris » · "describe" |

The extension also registers global shortcuts via `chrome.commands` (e.g. `Alt+Shift+N` to start Kalima on the current page), because screen readers capture single keys in browse mode.

## 6. Non-functional requirements (from the cahier)

| Criterion | Target |
|---|---|
| Accessibility | WCAG 2.2 AA for the website **and** the extension |
| Performance | First spoken words < 5 s after pressing play; image description < 5 s |
| Privacy | GDPR: EU data region, minimal data, uploads auto-deleted after N days, anonymised analytics |
| Compatibility | Chrome + Edge (Manifest V3); Firefox if time allows |
| Languages | French + English |
| Robustness | Works on poorly structured pages (generic fallback extractor) |

## 7. Success criteria

- A blind user can follow a **complete lesson on at least 2 major platforms** (target: Moodle + Coursera or Google Classroom) using only voice and keyboard.
- A blind user can take a PDF course end to end: explanation → question → quiz → correction.
- Visually impaired testers judge the image descriptions relevant and useful.
- A clear path to scaling and social impact.

## 8. Social-impact indicators

Tracked anonymously in `usage_events`:

- Learning sessions started and completed (volume, completion rate).
- Time from "play" to understanding a visual (time to access content).
- Questions asked per session, quiz scores and improvement after review.
- In-app satisfaction prompt (NPS-style) at the end of a course.
- Partners onboarded (tracked manually).

## 9. Deliverables

1. Working website (PWA) + browser extension (MVP).
2. Technical docs + accessible user guide (audio + text).
3. Social-impact report (method + first user feedback).
4. Demo video on real e-learning platforms.
5. Impact-focused pitch.

## 10. Demo script (draft)

1. **Screen off.** The tester opens Kalima and uploads a course PDF (biology chapter with a diagram).
2. Kalima explains the first chunks aloud and describes the diagram.
3. Tester presses `Space`, asks "what is the difference between mitosis and meiosis?", gets the answer, presses `Space` again → Kalima continues.
4. End of course → quiz → one wrong answer → Kalima explains the mistake and re-teaches that part.
5. Switch to the **extension** on a Moodle lesson → same flow on a live page.
6. Show the impact numbers (before / after).

## 11. Open decisions

- [x] Name: **Kalima** (كلمة — "word")
- [x] Colors: light mode, green primary, white, red secondary (`ARCHITECTURE.md` §8b)
- [x] Main model: `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` (see `ARCHITECTURE.md` §5)
- [ ] Embedding model (NVIDIA, for Q&A retrieval)
- [ ] Second demo platform (Coursera or Google Classroom)
- [ ] Speech: browser Web Speech API (default) vs NVIDIA Riva (Parakeet / Magpie)
