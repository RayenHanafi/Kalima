import {
  QuizSchema,
  quizMessages,
  resolveChoice,
  TASK_REASONING,
  trueFalseLabels,
  type Chunk,
  type Lang,
  type PublicQuizQuestion,
  type QuizDraft,
  type QuizQuestion,
} from "@kalima/lesson-engine";
import { chat } from "@kalima/llm";
import { z } from "zod";
import { aiFailure, fail, readJson } from "@/lib/http";
import { asQuestions, loadSession } from "@/lib/lesson/data";
import { authenticate } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 90;

const Body = z.object({ regenerate: z.boolean().optional() });

/** Generates (or returns) the end-of-course quiz. Answers never leave the server. */
export async function POST(req: Request, ctx: RouteContext<"/api/sessions/[id]/quiz">) {
  const auth = await authenticate(req);
  if (auth instanceof Response) return auth;
  const body = await readJson(req, Body);
  if (body instanceof Response) return body;
  const { id } = await ctx.params;
  const { db } = auth;

  const loaded = await loadSession(db, id);
  if (!loaded) return fail(404, "session_not_found");
  const { chunks, lang, courseTitle } = loaded;

  if (!body.regenerate) {
    const { data: existing } = await db
      .from("quizzes")
      .select("id, questions")
      .eq("session_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) return Response.json({ quizId: existing.id, cached: true, questions: publicView(asQuestions(existing.questions)) });
  }

  let draft;
  try {
    draft = await chat({
      messages: quizMessages({ lang, courseTitle, chunks }),
      schema: QuizSchema,
      reasoning: TASK_REASONING.quiz,
      maxTokens: 3000,
      signal: req.signal,
    });
  } catch (err) {
    return aiFailure(err);
  }

  const questions = normalize(draft.data, chunks, lang);
  if (questions.length < 3) return fail(502, "ai_bad_output", "too few valid questions");

  const { data: quiz, error } = await db
    .from("quizzes")
    .insert({ session_id: id, questions: questions as unknown as never })
    .select("id")
    .single();
  if (error) throw error;
  await db.from("lesson_sessions").update({ status: "QUIZ" }).eq("id", id);

  return Response.json({ quizId: quiz.id, cached: false, provider: draft.provider, questions: publicView(questions) });
}

/** Fixes the model's small mistakes; drops questions that can't be graded reliably. */
function normalize(draft: QuizDraft, chunks: Chunk[], lang: Lang): QuizQuestion[] {
  const out: QuizQuestion[] = [];
  for (const q of draft.questions) {
    const chunk = chunks[Math.min(chunks.length - 1, Math.max(0, q.part - 1))]!;
    const base = { id: `q${out.length + 1}`, question: q.question.trim(), chunkIdx: chunk.idx, chunkId: chunk.id };
    if (q.type === "short") {
      out.push({ ...base, type: "short", options: [], answer: q.answer.trim() });
      continue;
    }
    const options = q.type === "true_false" ? trueFalseLabels(lang) : q.options.map((o) => o.trim()).filter(Boolean);
    if (q.type === "mcq" && (options.length < 2 || options.length > 5)) continue;
    const answer = resolveChoice({ type: q.type, options }, q.answer);
    if (!answer) continue;
    out.push({ ...base, type: q.type, options, answer });
  }
  return out;
}

function publicView(questions: QuizQuestion[]): PublicQuizQuestion[] {
  return questions.map(({ answer: _answer, ...q }) => q);
}
