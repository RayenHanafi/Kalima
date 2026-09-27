import {
  assembleChunks,
  PlanSchema,
  planMessages,
  TASK_REASONING,
  toBlocks,
  type FigureDescription,
} from "@kalima/lesson-engine";
import { chat } from "@kalima/llm";
import { z } from "zod";
import { aiFailure, fail, readJson } from "@/lib/http";
import { asLang, loadChunks, loadCourse } from "@/lib/lesson/data";
import { authenticate } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 120;

const Body = z.object({ force: z.boolean().optional() });

/** Turns the ingested pages into ordered teachable chunks (idempotent unless force=true). */
export async function POST(req: Request, ctx: RouteContext<"/api/courses/[id]/plan">) {
  const auth = await authenticate(req);
  if (auth instanceof Response) return auth;
  const body = await readJson(req, Body);
  if (body instanceof Response) return body;
  const { id } = await ctx.params;
  const { db } = auth;

  const course = await loadCourse(db, id);
  if (!course) return fail(404, "course_not_found");

  const existing = await loadChunks(db, id);
  if (existing.length && !body.force) return Response.json(summary(course.id, course.title, existing, true));

  const { data: pages, error } = await db.from("course_pages").select("*").eq("course_id", id).order("page_no");
  if (error) throw error;
  if (!pages.length) return fail(409, "course_not_ingested");

  const source = pages.map((p) => ({
    pageNo: p.page_no,
    text: p.text,
    figures: Array.isArray(p.figure_descriptions) ? (p.figure_descriptions as unknown as FigureDescription[]) : [],
  }));
  const blocks = toBlocks(source);
  const figures = new Map(source.flatMap((p) => p.figures.map((f) => [f.ref, f] as const)));
  const lang = asLang(course.lang);

  await db.from("courses").update({ status: "planning", error: null }).eq("id", id);
  let plan;
  try {
    plan = await chat({
      messages: planMessages({ lang, title: course.title, blocks }),
      schema: PlanSchema,
      reasoning: TASK_REASONING.plan,
      maxTokens: 4096,
      signal: req.signal,
    });
  } catch (err) {
    await db.from("courses").update({ status: "error", error: "planning_failed" }).eq("id", id);
    return aiFailure(err);
  }

  const chunks = assembleChunks(
    blocks,
    plan.data.chunks.map((c) => ({ title: c.title, startBlock: c.startBlock, endBlock: c.endBlock })),
    figures,
  );

  // Replace any previous plan (force=true). Chunk ids and cached explanations would be stale,
  // so the learner's sessions on this course start over.
  if (existing.length) {
    await db.from("lesson_sessions").delete().eq("course_id", id);
    await db.from("chunks").delete().eq("course_id", id);
  }
  const { data: inserted, error: insErr } = await db
    .from("chunks")
    .insert(
      chunks.map((c) => ({
        course_id: id,
        idx: c.idx,
        title: c.title,
        content: c.content,
        figure_descriptions: c.figures as unknown as never,
        page_ref: c.pageRef,
      })),
    )
    .select("*")
    .order("idx");
  if (insErr) throw insErr;

  const title = course.title || plan.data.title;
  await db.from("courses").update({ status: "ready", title }).eq("id", id);
  return Response.json({
    ...summary(id, title, inserted.map((r) => ({ id: r.id, idx: r.idx, title: r.title })), false),
    provider: plan.provider,
  });
}

function summary(courseId: string, title: string | null, chunks: { id: string; idx: number; title: string }[], cached: boolean) {
  return { courseId, title, cached, chunks: chunks.map((c) => ({ id: c.id, idx: c.idx, title: c.title })) };
}
