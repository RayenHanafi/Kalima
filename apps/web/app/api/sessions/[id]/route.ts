import { z } from "zod";
import { fail, readJson } from "@/lib/http";
import { authenticate } from "@/lib/supabase/server";

export const runtime = "nodejs";

const Body = z
  .object({
    status: z.enum(["EXPLAINING", "PAUSED", "ANSWERING", "QUIZ", "EVALUATED", "DONE"]),
    mode: z.enum(["normal", "review"]),
    currentChunkIdx: z.number().int().min(0),
    sentenceOffset: z.number().int().min(0),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, "nothing to update");

/** Saves the learner's position / state (the client's state machine is the driver). */
export async function PATCH(req: Request, ctx: RouteContext<"/api/sessions/[id]">) {
  const auth = await authenticate(req);
  if (auth instanceof Response) return auth;
  const body = await readJson(req, Body);
  if (body instanceof Response) return body;
  const { id } = await ctx.params;

  const { data, error } = await auth.db
    .from("lesson_sessions")
    .update({
      status: body.status,
      mode: body.mode,
      current_chunk_idx: body.currentChunkIdx,
      sentence_offset: body.sentenceOffset,
    })
    .eq("id", id)
    .select("id, status, mode, current_chunk_idx, sentence_offset")
    .maybeSingle();
  if (error) throw error;
  if (!data) return fail(404, "session_not_found");
  return Response.json({
    id: data.id,
    status: data.status,
    mode: data.mode,
    currentChunkIdx: data.current_chunk_idx,
    sentenceOffset: data.sentence_offset,
  });
}
