import { askMessages, TASK_REASONING } from "@kalima/lesson-engine";
import { chatStream } from "@kalima/llm";
import { z } from "zod";
import { track } from "@/lib/events";
import { fail, readJson } from "@/lib/http";
import { loadSession } from "@/lib/lesson/data";
import { sse } from "@/lib/sse";
import { authenticate } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  question: z.string().trim().min(1).max(1000),
  chunkIdx: z.number().int().min(0).optional(),
});

/** SSE: answers a learner's question from the whole course (MVP: full text, no retrieval). */
export async function POST(req: Request, ctx: RouteContext<"/api/sessions/[id]/ask">) {
  const auth = await authenticate(req);
  if (auth instanceof Response) return auth;
  const body = await readJson(req, Body);
  if (body instanceof Response) return body;
  const { id } = await ctx.params;
  const { db, userId } = auth;

  const loaded = await loadSession(db, id);
  if (!loaded) return fail(404, "session_not_found");
  const { session, chunks, lang, courseTitle } = loaded;
  const chunkIdx = body.chunkIdx ?? session.current_chunk_idx;

  const messages = askMessages({ lang, courseTitle, question: body.question, chunks, currentChunkIdx: chunkIdx });

  return sse(async (send, signal) => {
    await db.from("messages").insert({ session_id: id, role: "user", kind: "question", chunk_idx: chunkIdx, lang, content: body.question });
    const gen = chatStream({ messages, reasoning: TASK_REASONING.ask, maxTokens: 700, signal });
    let text = "";
    let step = await gen.next();
    while (!step.done) {
      text += step.value;
      send("delta", { text: step.value });
      step = await gen.next();
    }
    if (text.trim()) {
      await db.from("messages").insert({ session_id: id, role: "assistant", kind: "answer", chunk_idx: chunkIdx, lang, content: text.trim() });
    }
    track(userId, "question_asked", { meta: { provider: step.value.provider } });
    send("done", { chunkIdx, provider: step.value.provider });
  }, req.signal);
}
