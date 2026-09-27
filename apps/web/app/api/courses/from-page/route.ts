import { createHash } from "node:crypto";
import { z } from "zod";
import { track } from "@/lib/events";
import { aiFailure, readJson } from "@/lib/http";
import { describeImage } from "@/lib/lesson/describe";
import { loadImage } from "@/lib/lesson/image";
import { planCourse } from "@/lib/lesson/plan";
import { authenticate } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_IMAGES = 8;

// PagePayload from the extension (ARCHITECTURE.md §4.2); images are already downscaled data URLs.
const Body = z.object({
  platform: z.string().max(40),
  url: z.url().max(2000),
  title: z.string().max(300),
  lang: z.enum(["fr", "en"]).default("fr"),
  sections: z
    .array(z.object({ heading: z.string().max(500), text: z.string().max(50_000) }))
    .min(1)
    .max(200),
  images: z
    .array(
      z.object({
        dataUrl: z.string().max(1_500_000),
        alt: z.string().max(1000),
        nearbyText: z.string().max(2000),
        sectionIdx: z.number().int().min(0),
      }),
    )
    .max(20)
    .default([]),
});

/**
 * Turns an e-learning page into a ready course in one call: sections → pages, images described in
 * parallel, then planned. The same page (URL + content) returns the existing course instantly.
 */
export async function POST(req: Request) {
  const auth = await authenticate(req);
  if (auth instanceof Response) return auth;
  const body = await readJson(req, Body);
  if (body instanceof Response) return body;
  const { db } = auth;

  const hash = createHash("sha256")
    .update(`${body.lang}|${body.url.split("#")[0]}|${JSON.stringify(body.sections)}`)
    .digest("hex");

  const { data: existing } = await db
    .from("courses")
    .select("id, title")
    .eq("content_hash", hash)
    .eq("status", "ready")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return Response.json({ courseId: existing.id, title: existing.title, cached: true });

  const { data: course, error } = await db
    .from("courses")
    .insert({
      source_type: "web",
      title: body.title || null,
      source_url: body.url,
      platform: body.platform,
      lang: body.lang,
      content_hash: hash,
      page_count: body.sections.length,
      status: "ingesting",
    })
    .select("id")
    .single();
  if (error) throw error;
  track(auth.userId, "course_created", { platform: body.platform, meta: { sections: body.sections.length } });

  // Describe images in parallel; a failed image is skipped, never blocks the lesson.
  const described = await Promise.allSettled(
    body.images.slice(0, MAX_IMAGES).map(async (img, i) => {
      const loaded = await loadImage(img.dataUrl);
      const context = [img.alt && `Alt text: ${img.alt}`, img.nearbyText].filter(Boolean).join("\n");
      const d = await describeImage(db, loaded, body.lang, context, req.signal);
      return { sectionIdx: img.sectionIdx, figure: { ref: `s${img.sectionIdx + 1}-f${i + 1}`, short: d.short, detailed: d.detailed } };
    }),
  );
  const figuresBySection = new Map<number, { ref: string; short: string; detailed: string }[]>();
  for (const r of described) {
    if (r.status !== "fulfilled") continue;
    const list = figuresBySection.get(r.value.sectionIdx) ?? [];
    list.push(r.value.figure);
    figuresBySection.set(r.value.sectionIdx, list);
  }

  const { error: pagesErr } = await db.from("course_pages").insert(
    body.sections.map((s, i) => ({
      course_id: course.id,
      page_no: i + 1,
      text: [s.heading, s.text].filter(Boolean).join("\n\n"),
      figure_descriptions: (figuresBySection.get(i) ?? []) as unknown as never,
    })),
  );
  if (pagesErr) throw pagesErr;
  await db.from("courses").update({ pages_done: body.sections.length }).eq("id", course.id);

  try {
    const plan = await planCourse(db, course.id, { signal: req.signal });
    return Response.json({
      courseId: course.id,
      title: plan.title,
      cached: false,
      figures: [...figuresBySection.values()].flat().length,
      chunks: plan.chunks.length,
    });
  } catch (err) {
    return aiFailure(err);
  }
}
