import {
  explainMessages,
  splitSentences,
  stripGreeting,
  TASK_REASONING,
  type LessonMode,
  type Mistake,
  type QuestionResult,
} from "@kalima/lesson-engine";
import { chatStream } from "@kalima/llm";
import { z } from "zod";
import { track } from "@/lib/events";
import { fail, readJson } from "@/lib/http";
import { asQuestions, detailLevel, loadSession } from "@/lib/lesson/data";
import { sse } from "@/lib/sse";
import { authenticate, type Db } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  chunkIdx: z.number().int().min(0).optional(),
  mode: z.enum(["normal", "review"]).optional(),
});

/**
 * SSE: spoken explanation of one chunk. Cached per (session, chunk, lang, mode) in `messages`,
 * so replays and prefetched chunks are instant and cost no AI calls.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/sessions/[id]/explain">) {
  const auth = await authenticate(req);
  if (auth instanceof Response) return auth;
  const body = await readJson(req, Body);
  if (body instanceof Response) return body;
  const { id } = await ctx.params;
  const { db, userId } = auth;

  const loaded = await loadSession(db, id);
  if (!loaded) return fail(404, "session_not_found");
  const { session, chunks, lang, courseTitle } = loaded;

  const mode: LessonMode = body.mode ?? session.mode;
  const chunkIdx = body.chunkIdx ?? session.current_chunk_idx;
  const chunk = chunks.find((c) => c.idx === chunkIdx);
  if (!chunk) return fail(404, "chunk_not_found");
  const kind = mode === "review" ? "review" : "explain";

  const { data: cached } = await db
    .from("messages")
    .select("content")
    .eq("session_id", id)
    .eq("chunk_idx", chunkIdx)
    .eq("kind", kind)
    .eq("lang", lang)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const meta = { chunkIdx, chunkId: chunk.id, mode, title: chunk.title };

  if (cached) {
    return sse(async (send) => {
      for (const s of splitSentences(cached.content)) send("delta", { text: `${s} ` });
      send("done", { ...meta, cached: true });
    }, req.signal);
  }

  const mistakes = mode === "review" ? await mistakesFor(db, id, chunk.id) : undefined;
  const messages = explainMessages({
    lang,
    courseTitle,
    outline: chunks.map((c) => c.title),
    chunk,
    chunkCount: chunks.length,
    mode,
    detail: await detailLevel(db, userId),
    mistakes,
  });

  return sse(async (send, signal) => {
    const t0 = Date.now();
    let firstWordMs: number | undefined;
    const gen = chatStream({ messages, reasoning: TASK_REASONING.explain, maxTokens: 1024, signal });
    let text = "";
    // Hold the opening words until the first sentence ends, to drop a stray "Bonjour." greeting.
    let head: string | null = "";
    const emit = (piece: string) => {
      if (!piece) return;
      firstWordMs ??= Date.now() - t0;
      text += piece;
      send("delta", { text: piece });
    };
    let step = await gen.next();
    while (!step.done) {
      if (head === null) emit(step.value);
      else {
        head += step.value;
        if (/[.!?]/.test(head) || head.length > 60) {
          emit(stripGreeting(head));
          head = null;
        }
      }
      step = await gen.next();
    }
    if (head) emit(stripGreeting(head));
    const content = text.trim();
    if (content) {
      await db.from("messages").insert({ session_id: id, role: "assistant", kind, chunk_idx: chunkIdx, lang, content });
    }
    track(userId, "chunk_explained", { durationMs: firstWordMs, meta: { mode, provider: step.value.provider } });
    send("done", { ...meta, cached: false, provider: step.value.provider });
  }, req.signal);
}

/** Wrong answers from the latest quiz attempt that point at this chunk. */
async function mistakesFor(db: Db, sessionId: string, chunkId: string): Promise<Mistake[]> {
  const { data: quiz } = await db
    .from("quizzes")
    .select("id, questions")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!quiz) return [];
  const { data: attempt } = await db
    .from("quiz_attempts")
    .select("results")
    .eq("quiz_id", quiz.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!attempt) return [];
  const questions = new Map(asQuestions(quiz.questions).map((q) => [q.id, q]));
  return (attempt.results as unknown as QuestionResult[])
    .filter((r) => !r.correct && questions.get(r.id)?.chunkId === chunkId)
    .map((r) => ({ question: questions.get(r.id)!.question, learnerAnswer: r.learnerAnswer, correctAnswer: r.correctAnswer }));
}
