import { LlmJsonError, LlmUnavailableError } from "@kalima/llm";
import type { z } from "zod";

export function fail(status: number, error: string, detail?: string): Response {
  return Response.json({ error, ...(detail ? { detail } : {}) }, { status });
}

/** Parses and validates a JSON body; returns a 400 Response on bad input. */
export async function readJson<T>(req: Request, schema: z.ZodType<T>): Promise<T | Response> {
  let body: unknown = {};
  const text = await req.text();
  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      return fail(400, "invalid_json");
    }
  }
  const parsed = schema.safeParse(body);
  return parsed.success ? parsed.data : fail(400, "invalid_body", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
}

/** Maps AI failures to HTTP errors the client can act on (retry later vs. bad output). */
export function aiFailure(err: unknown): Response {
  if (err instanceof LlmUnavailableError) return fail(503, "ai_unavailable", err.message);
  if (err instanceof LlmJsonError) return fail(502, "ai_bad_output", err.message);
  throw err;
}
