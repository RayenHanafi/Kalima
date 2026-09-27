"use client";

import type { LessonApi } from "@kalima/ui";
import { accessToken } from "@/lib/supabase/browser";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`${status} ${code}`);
  }
}

async function call<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new ApiError(res.status, j.error ?? "error");
  }
  return res.json() as Promise<T>;
}

/** Reads `event: delta` texts from one of our SSE endpoints; throws on `event: error`. */
async function* sse(path: string, body: unknown, signal?: AbortSignal): AsyncGenerator<string> {
  const res = await fetch(path, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw new ApiError(res.status, "stream_failed");
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += value;
    let i;
    while ((i = buf.indexOf("\n\n")) !== -1) {
      const raw = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const event = raw.match(/^event: (.+)$/m)?.[1];
      const data = JSON.parse(raw.match(/^data: (.+)$/m)?.[1] ?? "null");
      if (event === "delta") yield data.text as string;
      else if (event === "error") throw new ApiError(503, data.error);
    }
  }
}

export const api = {
  call,
  lesson: {
    startSession: (courseId) => call("POST", "/api/sessions", { courseId }),
    saveSession: async (id, patch) => {
      await call("PATCH", `/api/sessions/${id}`, patch);
    },
    explain: (id, chunkIdx, mode, signal) => sse(`/api/sessions/${id}/explain`, { chunkIdx, mode }, signal),
    ask: (id, question, chunkIdx, signal) => sse(`/api/sessions/${id}/ask`, { question, chunkIdx }, signal),
    quiz: (id) => call("POST", `/api/sessions/${id}/quiz`, {}),
    submit: (quizId, answers) => call("POST", `/api/quizzes/${quizId}/submit`, { answers }),
  } satisfies LessonApi,
};
