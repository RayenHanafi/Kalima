import { LlmJsonError, LlmUnavailableError } from "@kalima/llm";
import { z } from "zod";
import { fail, readJson } from "@/lib/http";
import { asLang, loadCourse } from "@/lib/lesson/data";
import { describeImage } from "@/lib/lesson/describe";
import { ImageError, loadImage } from "@/lib/lesson/image";
import { authenticate } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// One page per request keeps bodies under Vercel's ~4.5 MB limit and makes ingestion resumable.
const Body = z.object({
  pageNo: z.number().int().min(1),
  text: z.string().max(100_000),
  /** JPEG/PNG data URL of the rendered page, only for pages with figures or no text layer. */
  image: z.string().max(4_000_000).optional(),
});

/** Stores one ingested page; describes its figures (or reads it, if scanned) with the vision model. */
export async function POST(req: Request, ctx: RouteContext<"/api/courses/[id]/pages">) {
  const auth = await authenticate(req);
  if (auth instanceof Response) return auth;
  const body = await readJson(req, Body);
  if (body instanceof Response) return body;
  const { id } = await ctx.params;
  const { db } = auth;

  const course = await loadCourse(db, id);
  if (!course) return fail(404, "course_not_found");
  const lang = asLang(course.lang);

  let text = body.text.trim();
  let figures: { ref: string; short: string; detailed: string }[] = [];
  let described: "none" | "ok" | "skipped" = "none";

  if (body.image) {
    try {
      const image = await loadImage(body.image);
      const scanned = text.length < 40;
      const d = await describeImage(
        db,
        image,
        lang,
        scanned ? "This page has no text layer (scanned): read its text too." : text.slice(0, 3000),
        req.signal,
      );
      figures = [{ ref: `p${body.pageNo}-f1`, short: d.short, detailed: d.detailed }];
      if (scanned) text = d.detailed; // scanned page: the description carries the page's content
      described = "ok";
    } catch (err) {
      // A figure we can't describe must not block the course: keep the text, flag it.
      if (!(err instanceof ImageError || err instanceof LlmUnavailableError || err instanceof LlmJsonError)) throw err;
      described = "skipped";
    }
  }

  const { error } = await db
    .from("course_pages")
    .upsert({ course_id: id, page_no: body.pageNo, text, figure_descriptions: figures as unknown as never });
  if (error) throw error;

  const { count } = await db.from("course_pages").select("page_no", { count: "exact", head: true }).eq("course_id", id);
  await db.from("courses").update({ pages_done: count ?? 0 }).eq("id", id);
  return Response.json({ pageNo: body.pageNo, pagesDone: count ?? 0, figures: figures.length, described });
}
