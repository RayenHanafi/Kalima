import {
  EvaluationSchema,
  evaluateMessages,
  gradeChoice,
  resolveChoice,
  TASK_REASONING,
  type QuestionResult,
} from "@kalima/lesson-engine";
import { chat, LlmJsonError, LlmUnavailableError } from "@kalima/llm";
import { z } from "zod";
import { track } from "@/lib/events";
import { fail, readJson } from "@/lib/http";
import { asLang, asQuestions, loadCourse } from "@/lib/lesson/data";
import { authenticate } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 90;

const Body = z.object({ answers: z.record(z.string(), z.string().max(500)) });

/**
 * Grades a quiz. Multiple choice / true-false are graded deterministically; the model grades short
 * answers and writes a spoken explanation for every question. If the AI is down, the deterministic
 * grades still come back (short answers by exact match).
 */
export async function POST(req: Request, ctx: RouteContext<"/api/quizzes/[id]/submit">) {
  const auth = await authenticate(req);
  if (auth instanceof Response) return auth;
  const body = await readJson(req, Body);
  if (body instanceof Response) return body;
  const { id } = await ctx.params;
  const { db } = auth;

  const { data: quiz } = await db.from("quizzes").select("id, session_id, questions").eq("id", id).maybeSingle();
  if (!quiz) return fail(404, "quiz_not_found");
  const { data: session } = await db.from("lesson_sessions").select("course_id").eq("id", quiz.session_id).single();
  const course = session ? await loadCourse(db, session.course_id) : null;
  const lang = asLang(course?.lang);
  const questions = asQuestions(quiz.questions);

  const items = questions.map((q) => {
    const raw = (body.answers[q.id] ?? "").trim();
    // "B" / "option 2" / "vrai" → the option's words, so feedback never says "the answer is B".
    const learnerAnswer = q.type === "short" ? raw : (resolveChoice(q, raw) ?? raw);
    return { question: q, learnerAnswer, knownCorrect: raw ? gradeChoice(q, raw) : false };
  });

  let verdicts = new Map<string, { correct: boolean; explanation: string }>();
  let provider: string | undefined;
  try {
    const evaluation = await chat({
      messages: evaluateMessages({ lang, items }),
      schema: EvaluationSchema,
      reasoning: TASK_REASONING.evaluate,
      maxTokens: 3000,
      signal: req.signal,
    });
    verdicts = new Map(evaluation.data.results.map((r) => [r.id, r]));
    provider = evaluation.provider;
  } catch (err) {
    if (!(err instanceof LlmUnavailableError || err instanceof LlmJsonError)) throw err;
  }

  const results: QuestionResult[] = items.map(({ question: q, learnerAnswer, knownCorrect }) => {
    const v = verdicts.get(q.id);
    const correct = knownCorrect ?? v?.correct ?? learnerAnswer.toLowerCase() === q.answer.toLowerCase();
    return { id: q.id, correct, learnerAnswer, correctAnswer: q.answer, explanation: v?.explanation ?? "", chunkIdx: q.chunkIdx };
  });

  const score = results.length ? results.filter((r) => r.correct).length / results.length : 0;
  const wrong = results.filter((r) => !r.correct);
  const weakChunkIdxs = [...new Set(wrong.map((r) => r.chunkIdx))].sort((a, b) => a - b);
  const byIdx = new Map(questions.map((q) => [q.chunkIdx, q.chunkId]));
  const weakChunkIds = weakChunkIdxs.map((i) => byIdx.get(i)!).filter(Boolean);

  const { data: attempt, error } = await db
    .from("quiz_attempts")
    .insert({ quiz_id: id, answers: body.answers, results: results as unknown as never, score, weak_chunk_ids: weakChunkIds })
    .select("id")
    .single();
  if (error) throw error;
  await db.from("lesson_sessions").update({ status: "EVALUATED" }).eq("id", quiz.session_id);
  track(auth.userId, "quiz_submitted", { meta: { score, total: results.length } });

  return Response.json({ attemptId: attempt.id, score, results, weakChunkIdxs, weakChunkIds, provider });
}
