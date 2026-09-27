import { z } from "zod";
import { track } from "@/lib/events";
import { readJson } from "@/lib/http";
import { authenticate } from "@/lib/supabase/server";

export const runtime = "nodejs";

const Body = z.object({
  title: z.string().trim().max(300).optional(),
  lang: z.enum(["fr", "en"]),
  pageCount: z.number().int().min(1).max(300),
  sourceType: z.enum(["pdf", "web"]).default("pdf"),
});

/**
 * Creates a course before ingestion. The PDF itself never leaves the browser: pages (text + an image
 * of pages with figures) are sent to POST /api/courses/:id/pages, then POST /api/courses/:id/plan.
 */
export async function POST(req: Request) {
  const auth = await authenticate(req);
  if (auth instanceof Response) return auth;
  const body = await readJson(req, Body);
  if (body instanceof Response) return body;

  const { data, error } = await auth.db
    .from("courses")
    .insert({
      source_type: body.sourceType,
      title: body.title || null,
      lang: body.lang,
      page_count: body.pageCount,
      status: "ingesting",
    })
    .select("id")
    .single();
  if (error) throw error;
  track(auth.userId, "course_created", { platform: body.sourceType, meta: { pages: body.pageCount } });
  return Response.json({ courseId: data.id });
}
