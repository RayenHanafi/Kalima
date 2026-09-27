import "server-only";
import { assembleChunks, PlanSchema, planMessages, TASK_REASONING, toBlocks, type FigureDescription } from "@kalima/lesson-engine";
import { chat } from "@kalima/llm";
import type { Db } from "@/lib/supabase/server";
import { asLang, loadChunks, loadCourse } from "./data";

export class PlanError extends Error {
  constructor(readonly code: "course_not_found" | "course_not_ingested") {
    super(code);
  }
}

/** Turns ingested pages into chunks (idempotent unless force). Throws Llm* errors on AI failure. */
export async function planCourse(db: Db, id: string, opts: { force?: boolean; signal?: AbortSignal } = {}) {
  const course = await loadCourse(db, id);
  if (!course) throw new PlanError("course_not_found");

  const existing = await loadChunks(db, id);
  if (existing.length && !opts.force) {
    return { courseId: id, title: course.title, cached: true, provider: undefined, chunks: existing.map(({ id, idx, title }) => ({ id, idx, title })) };
  }

  const { data: pages, error } = await db.from("course_pages").select("*").eq("course_id", id).order("page_no");
  if (error) throw error;
  if (!pages.length) throw new PlanError("course_not_ingested");

  const source = pages.map((p) => ({
    pageNo: p.page_no,
    text: p.text,
    figures: Array.isArray(p.figure_descriptions) ? (p.figure_descriptions as unknown as FigureDescription[]) : [],
  }));
  const blocks = toBlocks(source);
  const figures = new Map(source.flatMap((p) => p.figures.map((f) => [f.ref, f] as const)));

  await db.from("courses").update({ status: "planning", error: null }).eq("id", id);
  let plan;
  try {
    plan = await chat({
      messages: planMessages({ lang: asLang(course.lang), title: course.title, blocks }),
      schema: PlanSchema,
      reasoning: TASK_REASONING.plan,
      maxTokens: 4096,
      signal: opts.signal,
    });
  } catch (err) {
    await db.from("courses").update({ status: "error", error: "planning_failed" }).eq("id", id);
    throw err;
  }

  const chunks = assembleChunks(
    blocks,
    plan.data.chunks.map((c) => ({ title: c.title, startBlock: c.startBlock, endBlock: c.endBlock })),
    figures,
  );

  // Replacing a plan: chunk ids and cached explanations would be stale, so sessions start over.
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
    .select("id, idx, title")
    .order("idx");
  if (insErr) throw insErr;

  const title = course.title || plan.data.title;
  await db.from("courses").update({ status: "ready", title }).eq("id", id);
  return { courseId: id, title, cached: false, provider: plan.provider, chunks: inserted };
}
