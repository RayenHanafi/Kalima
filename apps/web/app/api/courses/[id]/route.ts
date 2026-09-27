import { fail } from "@/lib/http";
import { loadChunks, loadCourse } from "@/lib/lesson/data";
import { authenticate } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** Course status + chunk outline (no full content). */
export async function GET(req: Request, ctx: RouteContext<"/api/courses/[id]">) {
  const auth = await authenticate(req);
  if (auth instanceof Response) return auth;
  const { id } = await ctx.params;

  const course = await loadCourse(auth.db, id);
  if (!course) return fail(404, "course_not_found");
  const chunks = await loadChunks(auth.db, id);
  return Response.json({
    course: {
      id: course.id,
      title: course.title,
      lang: course.lang,
      status: course.status,
      sourceType: course.source_type,
      pageCount: course.page_count,
      pagesDone: course.pages_done,
    },
    chunks: chunks.map((c) => ({ id: c.id, idx: c.idx, title: c.title, pageRef: c.pageRef, figureCount: c.figures.length })),
  });
}
