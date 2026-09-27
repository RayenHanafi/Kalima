import "server-only";
import { describeImageMessages, ImageDescriptionSchema, TASK_REASONING, type Lang } from "@kalima/lesson-engine";
import { chat } from "@kalima/llm";
import { serviceDb, type Db } from "@/lib/supabase/server";
import type { LoadedImage } from "./image";

/** Cached image description (shared cache by sha256 + lang; only the service role writes it). */
export async function describeImage(db: Db, image: LoadedImage, lang: Lang, context?: string, signal?: AbortSignal) {
  const { data: hit } = await db
    .from("image_descriptions")
    .select("short, detailed")
    .eq("image_hash", image.hash)
    .eq("lang", lang)
    .maybeSingle();
  if (hit) return { ...hit, cached: true as const, provider: undefined };

  const result = await chat({
    messages: describeImageMessages({ lang, imageUrl: image.dataUrl, context }),
    schema: ImageDescriptionSchema,
    reasoning: TASK_REASONING.describeImage,
    maxTokens: 800,
    timeoutMs: 45_000,
    signal,
  });
  await serviceDb()
    .from("image_descriptions")
    .upsert({ image_hash: image.hash, lang, short: result.data.short, detailed: result.data.detailed, model: result.model });
  return { ...result.data, cached: false as const, provider: result.provider };
}
