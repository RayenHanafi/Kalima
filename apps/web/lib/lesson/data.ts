import "server-only";
import type { Chunk, FigureDescription, Lang, LessonMode, LessonStatus, QuizQuestion } from "@kalima/lesson-engine";
import type { Tables } from "@/lib/database.types";
import type { Db } from "@/lib/supabase/server";

export const asLang = (v: string | null | undefined): Lang => (v === "en" ? "en" : "fr");

function asFigures(v: unknown): FigureDescription[] {
  return Array.isArray(v) ? (v as FigureDescription[]).filter((f) => f && typeof f.detailed === "string") : [];
}

export function toChunk(row: Tables<"chunks">): Chunk {
  return {
    id: row.id,
    idx: row.idx,
    title: row.title,
    content: row.content,
    figures: asFigures(row.figure_descriptions),
    pageRef: row.page_ref,
  };
}

export async function loadChunks(db: Db, courseId: string): Promise<Chunk[]> {
  const { data, error } = await db.from("chunks").select("*").eq("course_id", courseId).order("idx");
  if (error) throw error;
  return data.map(toChunk);
}

export async function loadCourse(db: Db, courseId: string) {
  const { data, error } = await db.from("courses").select("*").eq("id", courseId).maybeSingle();
  if (error) throw error;
  return data;
}

/** Session + its course + chunks, all through RLS (null if not the caller's). */
export async function loadSession(db: Db, sessionId: string) {
  const { data: session, error } = await db.from("lesson_sessions").select("*").eq("id", sessionId).maybeSingle();
  if (error) throw error;
  if (!session) return null;
  const course = await loadCourse(db, session.course_id);
  if (!course) return null;
  const chunks = await loadChunks(db, course.id);
  return {
    session: {
      ...session,
      status: session.status as LessonStatus,
      mode: session.mode as LessonMode,
    },
    course,
    chunks,
    courseTitle: course.title ?? "",
    lang: asLang(course.lang),
  };
}

export async function detailLevel(db: Db, userId: string) {
  const { data } = await db.from("profiles").select("detail_level").eq("id", userId).maybeSingle();
  const d = data?.detail_level;
  return d === "short" || d === "detailed" ? d : "normal";
}

export function asQuestions(v: unknown): QuizQuestion[] {
  return Array.isArray(v) ? (v as QuizQuestion[]) : [];
}
