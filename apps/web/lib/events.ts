import "server-only";
import { createHash } from "node:crypto";
import type { Json } from "@/lib/database.types";
import { serviceDb } from "@/lib/supabase/server";

export type EventName =
  | "course_created"
  | "session_started"
  | "session_completed"
  | "chunk_explained"
  | "question_asked"
  | "quiz_submitted";

/**
 * Anonymous impact metric (PROJECT.md §8). No names, emails or course content: the user id is
 * one-way hashed. Fire-and-forget: tracking must never slow down or break the lesson.
 */
export function track(userId: string, event: EventName, extra: { platform?: string; durationMs?: number; meta?: Json } = {}) {
  const anon_id = createHash("sha256").update(`kalima:${userId}`).digest("hex").slice(0, 16);
  void serviceDb()
    .from("usage_events")
    .insert({ anon_id, event, platform: extra.platform ?? null, duration_ms: extra.durationMs ?? null, meta: extra.meta ?? {} })
    .then(({ error }) => error && console.error("[events]", error.message));
}
