import { z } from "zod";
import { aiFailure, fail, readJson } from "@/lib/http";
import { describeImage } from "@/lib/lesson/describe";
import { ImageError, loadImage } from "@/lib/lesson/image";
import { authenticate } from "@/lib/supabase/server";

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
  try {
    const d = await describeImage(auth.db, image, body.lang, body.context, req.signal);
    return Response.json({ short: d.short, detailed: d.detailed, hash: image.hash, cached: d.cached, provider: d.provider });
  } catch (err) {
    return aiFailure(err);
  }
}
