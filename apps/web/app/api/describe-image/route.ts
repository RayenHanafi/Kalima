import { describeImageMessages, ImageDescriptionSchema, TASK_REASONING } from "@kalima/lesson-engine";
import { chat } from "@kalima/llm";
import { z } from "zod";
import { aiFailure, fail, readJson } from "@/lib/http";
import { ImageError, loadImage } from "@/lib/lesson/image";
import { authenticate, serviceDb } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  image: z.string().min(1).max(8_000_000).describe("data: URL or public https URL"),
  context: z.string().max(4000).optional(),
  lang: z.enum(["fr", "en"]).default("fr"),
});

/** { short, detailed } description of an educational image, cached by sha256 + lang for everyone. */
export async function POST(req: Request) {
  const auth = await authenticate(req);
  if (auth instanceof Response) return auth;
  const body = await readJson(req, Body);
  if (body instanceof Response) return body;

  let image;
  try {
    image = await loadImage(body.image);
  } catch (err) {
    if (err instanceof ImageError) return fail(400, "bad_image", err.message);
    throw err;
  }

  const { data: hit } = await auth.db
    .from("image_descriptions")
    .select("short, detailed")
    .eq("image_hash", image.hash)
    .eq("lang", body.lang)
    .maybeSingle();
  if (hit) return Response.json({ ...hit, hash: image.hash, cached: true });

  let result;
  try {
    result = await chat({
      messages: describeImageMessages({ lang: body.lang, imageUrl: image.dataUrl, context: body.context }),
      schema: ImageDescriptionSchema,
      reasoning: TASK_REASONING.describeImage,
      maxTokens: 800,
      timeoutMs: 45_000,
      signal: req.signal,
    });
  } catch (err) {
    return aiFailure(err);
  }

  // Shared cache (no personal data): only the service role may write it (ARCHITECTURE.md §7).
  await serviceDb()
    .from("image_descriptions")
    .upsert({ image_hash: image.hash, lang: body.lang, short: result.data.short, detailed: result.data.detailed, model: result.model });

  return Response.json({ ...result.data, hash: image.hash, cached: false, provider: result.provider });
}
