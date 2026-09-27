import { LlmStreamError, LlmUnavailableError } from "@kalima/llm";

export type Send = (event: "delta" | "done" | "error", data: unknown) => void;

/**
 * Server-Sent Events response. Events:
 *   delta {text}              — next piece of visible text
 *   done  {…meta}             — finished (provider, cached, ids)
 *   error {error, midStream}  — midStream=true means some text was already sent
 */
export function sse(run: (send: Send, signal: AbortSignal) => Promise<void>, signal: AbortSignal): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send: Send = (event, data) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          open = false; // client went away
        }
      };
      try {
        await run(send, signal);
      } catch (err) {
        if (!signal.aborted) {
          const midStream = err instanceof LlmStreamError;
          const error = err instanceof LlmUnavailableError ? "ai_unavailable" : midStream ? "stream_interrupted" : "internal_error";
          if (!(err instanceof LlmUnavailableError) && !midStream) console.error("[sse]", err);
          send("error", { error, midStream });
        }
      } finally {
        open = false;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
