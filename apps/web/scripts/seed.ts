/**
 * DEV ONLY — end-to-end check of the lesson workflow through the real API (dev server must run).
 *   pnpm --filter web seed              # English
 *   pnpm --filter web seed -- --lang fr # French
 * Creates/reuses the test user seed@kalima.test, a 2-page biology course with one chart,
 * then: describe image → plan → session → explain (+ cached replay) → ask ×2 → quiz → submit
 * (one wrong answer on purpose) → review. Writes .seed-session.json (git-ignored) for curl tests.
 */
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/database.types";

process.loadEnvFile(path.resolve(import.meta.dirname, "../../../.env.local"));
const BASE = process.env.SEED_BASE_URL ?? "http://localhost:3000";
const LANG = process.argv.includes("fr") ? "fr" : "en";
const EMAIL = "seed@kalima.test";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const noSession = { persistSession: false, autoRefreshToken: false };

const CHART_URL =
  "https://quickchart.io/chart?format=png&width=500&height=300&c=" +
  encodeURIComponent(
    JSON.stringify({
      type: "bar",
      data: {
        labels: ["Mitosis", "Meiosis"],
        datasets: [
          { label: "Daughter cells produced", data: [2, 4] },
          { label: "Chromosomes per human daughter cell", data: [46, 23] },
        ],
      },
      options: { title: { display: true, text: "Mitosis vs meiosis" } },
    }),
  );

const PAGE_1 = `Cell division is how living things grow, repair tissue and reproduce. Before a cell divides, it copies its DNA, so each chromosome is made of two identical sister chromatids joined at the centromere.

Mitosis produces two daughter cells that are genetically identical to the parent cell. It has four phases. In prophase, chromosomes condense and the nuclear envelope breaks down. In metaphase, chromosomes line up in the middle of the cell. In anaphase, sister chromatids are pulled to opposite poles. In telophase, two new nuclei form, and cytokinesis then splits the cytoplasm.

Mitosis is used for growth and for repairing damaged tissue, for example when skin heals after a cut. A human body cell has 46 chromosomes, and after mitosis each daughter cell still has 46.`;

const PAGE_2 = `Meiosis is a special division that makes gametes: sperm and egg cells. It has two divisions in a row, meiosis one and meiosis two, and produces four daughter cells.

Each daughter cell of meiosis has half the number of chromosomes of the parent cell. In humans, gametes have 23 chromosomes, so when a sperm and an egg join at fertilisation, the new cell has 46 again.

During meiosis one, matching chromosomes exchange pieces of DNA in a process called crossing over. This is why the four cells are genetically different from each other, and why brothers and sisters do not look exactly alike. The chart compares the two divisions.`;

const t0 = Date.now();
const ms = (start: number) => `${Date.now() - start}ms`;
const line = (s = "") => console.log(s);
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const step = (s: string) => line(`\n━━ ${s} ━━`);
const wrap = (s: string) => s.replace(/\s+/g, " ").trim().replace(/(.{1,110})(\s|$)/g, "   $1\n").trimEnd();

let token = "";

async function api<T>(method: string, route: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${route}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${route} → HTTP ${res.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text) as T;
}

/** Consumes an SSE endpoint; returns the text, time to first delta and the done payload. */
async function stream(route: string, body: unknown) {
  const start = Date.now();
  const res = await fetch(`${BASE}${route}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) throw new Error(`POST ${route} → HTTP ${res.status}: ${await res.text()}`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  let text = "";
  let firstMs = 0;
  let done: Record<string, unknown> | undefined;
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    buf += value;
    let i;
    while ((i = buf.indexOf("\n\n")) !== -1) {
      const raw = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const event = raw.match(/^event: (.+)$/m)?.[1];
      const data = JSON.parse(raw.match(/^data: (.+)$/m)?.[1] ?? "null");
      if (event === "delta") {
        if (!firstMs) firstMs = Date.now() - start;
        text += data.text;
      } else if (event === "done") done = data;
      else if (event === "error") throw new Error(`${route} stream error: ${JSON.stringify(data)}`);
    }
  }
  return { text: text.trim(), firstMs, totalMs: Date.now() - start, done };
}

async function signIn() {
  const admin = createClient<Database>(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: noSession });
  const password = randomBytes(18).toString("base64url");
  const created = await admin.auth.admin.createUser({ email: EMAIL, password, email_confirm: true });
  if (created.error) {
    const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const existing = data.users.find((u) => u.email === EMAIL);
    if (!existing) throw created.error;
    const upd = await admin.auth.admin.updateUserById(existing.id, { password });
    if (upd.error) throw upd.error;
  }
  const userClient = createClient<Database>(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: noSession });
  const { data, error } = await userClient.auth.signInWithPassword({ email: EMAIL, password });
  if (error) throw error;
  token = data.session.access_token;
  // Acts as the seed user: every write below goes through RLS, like the real app.
  return createClient<Database>(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: noSession,
  });
}

async function main() {
  line(`Kalima seed — ${BASE} — lang=${LANG}`);
  step("1. Sign in (test user, via RLS)");
  const db = await signIn();
  line(`   ✓ signed in as ${EMAIL}`);
  // Start clean: remove this test user's earlier seed courses (cascades to pages, chunks, sessions…).
  await db.from("courses").delete().not("id", "is", null);

  step("2. Describe the chart image");
  let s = Date.now();
  const img = await api<{ short: string; detailed: string; cached: boolean; provider?: string }>("POST", "/api/describe-image", {
    image: CHART_URL,
    context: PAGE_2,
    lang: LANG,
  });
  line(`   ✓ ${ms(s)} cached=${img.cached}${img.provider ? ` provider=${img.provider}` : ""}`);
  line(`   short:\n${wrap(img.short)}`);
  line(`   detailed:\n${wrap(img.detailed)}`);

  step("3. Create the course + pages (as if ingested)");
  const { data: course, error } = await db
    .from("courses")
    .insert({ source_type: "pdf", lang: LANG, status: "ingesting", page_count: 2, pages_done: 2 })
    .select("id")
    .single();
  if (error) throw error;
  const { error: pagesErr } = await db.from("course_pages").insert([
    // Multi-row inserts send NULL (not the column default) for keys a row omits, so be explicit.
    { course_id: course.id, page_no: 1, text: PAGE_1, figure_descriptions: [] },
    {
      course_id: course.id,
      page_no: 2,
      text: PAGE_2,
      figure_descriptions: [{ ref: "p2-f1", short: img.short, detailed: img.detailed }],
    },
  ]);
  if (pagesErr) throw pagesErr;
  line(`   ✓ course ${course.id}`);

  step("4. Plan into chunks");
  s = Date.now();
  const plan = await api<{ title: string; chunks: { idx: number; title: string }[]; provider?: string }>(
    "POST",
    `/api/courses/${course.id}/plan`,
    {},
  );
  line(`   ✓ ${ms(s)} provider=${plan.provider} title="${plan.title}"`);
  for (const c of plan.chunks) line(`   ${c.idx + 1}. ${c.title}`);

  step("5. Start a session");
  const { session } = await api<{ session: { id: string } }>("POST", "/api/sessions", { courseId: course.id });
  line(`   ✓ session ${session.id}`);
  writeFileSync(
    path.resolve(import.meta.dirname, "../.seed-session.json"),
    JSON.stringify({ base: BASE, token, sessionId: session.id, courseId: course.id }, null, 2),
  );

  step("6. Explain chunk 1 (SSE)");
  const ex = await stream(`/api/sessions/${session.id}/explain`, { chunkIdx: 0 });
  line(`   ✓ first words after ${ex.firstMs}ms, total ${ex.totalMs}ms, provider=${ex.done?.provider}`);
  line(wrap(ex.text));

  step("7. Explain chunk 1 again (should be cached)");
  const ex2 = await stream(`/api/sessions/${session.id}/explain`, { chunkIdx: 0 });
  line(`   ✓ cached=${ex2.done?.cached} first words after ${ex2.firstMs}ms, total ${ex2.totalMs}ms, same text=${norm(ex2.text) === norm(ex.text)}`);

  step("8. Ask a question from the course (SSE)");
  const q1 = LANG === "fr" ? "Quelle est la différence entre la mitose et la méiose ?" : "What is the difference between mitosis and meiosis?";
  const a1 = await stream(`/api/sessions/${session.id}/ask`, { question: q1, chunkIdx: 0 });
  line(`   Q: ${q1}\n   ✓ first words after ${a1.firstMs}ms, total ${a1.totalMs}ms`);
  line(wrap(a1.text));

  step("9. Ask a question NOT in the course (SSE)");
  const q2 = LANG === "fr" ? "Qui a découvert la structure de l'ADN ?" : "Who discovered the structure of DNA?";
  const a2 = await stream(`/api/sessions/${session.id}/ask`, { question: q2 });
  line(`   Q: ${q2}\n   ✓ ${a2.totalMs}ms`);
  line(wrap(a2.text));

  step("10. Generate the quiz");
  s = Date.now();
  const quiz = await api<{ quizId: string; provider?: string; questions: { id: string; type: string; question: string; options: string[] }[] }>(
    "POST",
    `/api/sessions/${session.id}/quiz`,
    {},
  );
  line(`   ✓ ${ms(s)} provider=${quiz.provider} ${quiz.questions.length} questions (answers not sent to the client)`);
  for (const q of quiz.questions) line(`   ${q.id} [${q.type}] ${q.question}${q.options.length ? `  → ${q.options.join(" / ")}` : ""}`);

  step("11. Submit answers (question 1 wrong on purpose)");
  const { data: stored } = await db.from("quizzes").select("questions").eq("id", quiz.quizId).single();
  const full = stored!.questions as unknown as { id: string; type: string; options: string[]; answer: string }[];
  const answers: Record<string, string> = {};
  full.forEach((q, i) => {
    if (i === 0) {
      answers[q.id] = q.type === "short" ? "I don't know" : q.options.find((o) => o !== q.answer)!;
    } else if (q.type === "mcq") {
      answers[q.id] = "abcde"[q.options.indexOf(q.answer)]!.toUpperCase(); // spoken-style letter
    } else {
      answers[q.id] = q.answer;
    }
  });
  s = Date.now();
  const graded = await api<{
    score: number;
    weakChunkIdxs: number[];
    provider?: string;
    results: { id: string; correct: boolean; learnerAnswer: string; correctAnswer: string; explanation: string }[];
  }>("POST", `/api/quizzes/${quiz.quizId}/submit`, { answers });
  line(`   ✓ ${ms(s)} provider=${graded.provider} score=${Math.round(graded.score * 100)}% weak chunks=${graded.weakChunkIdxs.map((i) => i + 1).join(", ") || "none"}`);
  for (const r of graded.results) {
    line(`   ${r.correct ? "✓ Correct  " : "✗ Incorrect"} ${r.id}: answered "${r.learnerAnswer}" (right: "${r.correctAnswer}")`);
    if (r.explanation) line(wrap(r.explanation));
  }

  if (graded.weakChunkIdxs.length) {
    step(`12. Review: re-explain chunk ${graded.weakChunkIdxs[0]! + 1} (SSE, mode=review)`);
    const rv = await stream(`/api/sessions/${session.id}/explain`, { chunkIdx: graded.weakChunkIdxs[0], mode: "review" });
    line(`   ✓ first words after ${rv.firstMs}ms, total ${rv.totalMs}ms`);
    line(wrap(rv.text));
  }

  line(`\n✔ Seed finished in ${ms(t0)}. Session saved to apps/web/.seed-session.json for curl tests.`);
}

main().catch((err) => {
  console.error(`\n✗ Seed failed: ${err instanceof Error ? err.message : JSON.stringify(err)}`);
  process.exit(1);
});
