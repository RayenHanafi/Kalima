import { createClient } from '@supabase/supabase-js';
import type { PagePayload } from '@kalima/lesson-engine';
import type { LessonApi } from '@kalima/ui';

declare const __KALIMA_API__: string;
declare const __SUPABASE_URL__: string;
declare const __SUPABASE_KEY__: string;

export const API_BASE = __KALIMA_API__;

// Session kept in chrome.storage.local so it survives closing the side panel.
const storage = {
  getItem: async (k: string) => ((await browser.storage.local.get(k))[k] as string | undefined) ?? null,
  setItem: async (k: string, v: string) => browser.storage.local.set({ [k]: v }),
  removeItem: async (k: string) => browser.storage.local.remove(k),
};

const db = createClient(__SUPABASE_URL__, __SUPABASE_KEY__, {
  auth: { storage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

async function token(): Promise<string> {
  const { data } = await db.auth.getSession();
  if (data.session) return data.session.access_token;
  const { data: anon, error } = await db.auth.signInAnonymously();
  if (error || !anon.session) throw new Error(`sign-in failed: ${error?.message ?? 'no session'}`);
  return anon.session.access_token;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.json().catch(() => ({}))).error ?? 'error'}`);
  return res.json() as Promise<T>;
}

async function* sse(path: string, body: unknown, signal?: AbortSignal): AsyncGenerator<string> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`${res.status} stream_failed`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += value;
    let i;
    while ((i = buf.indexOf('\n\n')) !== -1) {
      const raw = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const event = raw.match(/^event: (.+)$/m)?.[1];
      const data = JSON.parse(raw.match(/^data: (.+)$/m)?.[1] ?? 'null');
      if (event === 'delta') yield data.text as string;
      else if (event === 'error') throw new Error(data.error);
    }
  }
}

export const lessonApi: LessonApi = {
  startSession: (courseId) => call('POST', '/api/sessions', { courseId }),
  saveSession: async (id, patch) => {
    await call('PATCH', `/api/sessions/${id}`, patch);
  },
  explain: (id, chunkIdx, mode, signal) => sse(`/api/sessions/${id}/explain`, { chunkIdx, mode }, signal),
  ask: (id, question, chunkIdx, signal) => sse(`/api/sessions/${id}/ask`, { question, chunkIdx }, signal),
  quiz: (id) => call('POST', `/api/sessions/${id}/quiz`, {}),
  submit: (quizId, answers) => call('POST', `/api/quizzes/${quizId}/submit`, { answers }),
};

export const createCourseFromPage = (payload: PagePayload) =>
  call<{ courseId: string; title: string | null; cached: boolean }>('POST', '/api/courses/from-page', payload);
