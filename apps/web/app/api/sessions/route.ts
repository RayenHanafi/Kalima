import { z } from "zod";
import { fail, readJson } from "@/lib/http";
import { loadChunks, loadCourse } from "@/lib/lesson/data";
import { authenticate } from "@/lib/supabase/server";

export const runtime = "nodejs";

const Body = z.object({ courseId: z.uuid(), restart: z.boolean().optional() });

/** Resumes the learner's latest session on this course, or starts a new one. */
export async function POST(req: Request) {
  const auth = await authenticate(req);
  if (auth instanceof Response) return auth;
  const body = await readJson(req, Body);
  if (body instanceof Response) return body;
  const { db } = auth;

  const course = await loadCourse(db, body.courseId);
  if (!course) return fail(404, "course_not_found");
  if (course.status !== "ready") return fail(409, "course_not_ready", course.status);
  const chunks = await loadChunks(db, course.id);

  let session;
  if (!body.restart) {
    const { data } = await db
      .from("lesson_sessions")
      .select("*")
      .eq("course_id", course.id)
      .neq("status", "DONE")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    session = data;
  }
  const resumed = Boolean(session);
  if (!session) {
    const { data, error } = await db.from("lesson_sessions").insert({ course_id: course.id }).select("*").single();
    if (error) throw error;
    session = data;
  }

  return Response.json({
    resumed,
    session: {
      id: session.id,
      courseId: session.course_id,
      status: session.status,
      mode: session.mode,
      currentChunkIdx: session.current_chunk_idx,
      sentenceOffset: session.sentence_offset,
    },
    course: { id: course.id, title: course.title, lang: course.lang },
    chunks: chunks.map((c) => ({ id: c.id, idx: c.idx, title: c.title })),
  });
}
