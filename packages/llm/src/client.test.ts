import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createLlm } from './client';
import { LlmUnavailableError } from './errors';
import type { CallLog, ProviderConfig, ProviderName } from './types';

const HOSTS: Record<string, ProviderName> = {
  'nv.test': 'nvidia',
  'groq.test': 'groq',
  'or.test': 'openrouter',
};

function provider(name: ProviderName, host: string): ProviderConfig {
  return { name, baseURL: `https://${host}/v1`, apiKey: 'test-key', textModel: `${name}-text`, visionModel: `${name}-vision` };
}

const PROVIDERS = [provider('nvidia', 'nv.test'), provider('groq', 'groq.test')];

type Reply = { status: number; body?: unknown; headers?: Record<string, string>; sse?: string[] };

const completion = (content: string) => ({
  id: 'x',
  object: 'chat.completion',
  created: 0,
  model: 'm',
  choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
});

const chunk = (content: string) =>
  `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta: { content } }] })}\n\n`;

/** Fake fetch: `script[provider]` is consumed one reply per call; the last reply repeats. */
function fakeFetch(script: Partial<Record<ProviderName, Reply[]>>) {
  const calls: ProviderName[] = [];
  const bodies: Record<string, unknown>[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const name = HOSTS[url.host]!;
    calls.push(name);
    bodies.push(JSON.parse(String(init?.body ?? '{}')));
    const queue = script[name] ?? [{ status: 500 }];
    const reply = queue.length > 1 ? queue.shift()! : queue[0]!;
    if (reply.sse) {
      return new Response(reply.sse.join('') + 'data: [DONE]\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }
    return new Response(JSON.stringify(reply.body ?? { error: { message: 'fail' } }), {
      status: reply.status,
      headers: { 'content-type': 'application/json', ...reply.headers },
    });
  });
  return { fn, calls, bodies };
}

function setup(script: Partial<Record<ProviderName, Reply[]>>, providers = PROVIDERS) {
  const f = fakeFetch(script);
  const sleeps: number[] = [];
  const logs: CallLog[] = [];
  const llm = createLlm({
    providers,
    fetch: f.fn as unknown as typeof fetch,
    sleep: async (ms) => void sleeps.push(ms),
    logger: (l) => void logs.push(l),
  });
  return { llm, calls: f.calls, bodies: f.bodies, sleeps, logs };
}

const ask = [{ role: 'user' as const, content: 'hi' }];

describe('provider chain', () => {
  it('succeeds on the first try', async () => {
    const { llm, calls, logs } = setup({ nvidia: [{ status: 200, body: completion('Hello') }] });
    const r = await llm.chat({ messages: ask });
    expect(r.text).toBe('Hello');
    expect(r.provider).toBe('nvidia');
    expect(calls).toEqual(['nvidia']);
    expect(logs).toEqual([expect.objectContaining({ provider: 'nvidia', attempt: 1, ok: true })]);
  });

  it('retries 3 times with backoff, then falls back to the next provider', async () => {
    const { llm, calls, sleeps } = setup({
      nvidia: [{ status: 503 }],
      groq: [{ status: 200, body: completion('From Groq') }],
    });
    const r = await llm.chat({ messages: ask });
    expect(r.provider).toBe('groq');
    expect(r.text).toBe('From Groq');
    expect(calls).toEqual(['nvidia', 'nvidia', 'nvidia', 'groq']);
    expect(sleeps).toEqual([500, 1000]);
  });

  it('skips straight to the next provider on 401', async () => {
    const { llm, calls, sleeps } = setup({
      nvidia: [{ status: 401 }],
      groq: [{ status: 200, body: completion('ok') }],
    });
    const r = await llm.chat({ messages: ask });
    expect(r.provider).toBe('groq');
    expect(calls).toEqual(['nvidia', 'groq']);
    expect(sleeps).toEqual([]);
  });

  it('throws LlmUnavailableError when every provider fails', async () => {
    const { llm, calls } = setup({ nvidia: [{ status: 500 }], groq: [{ status: 429 }] });
    const err = await llm.chat({ messages: ask }).catch((e) => e);
    expect(err).toBeInstanceOf(LlmUnavailableError);
    expect((err as LlmUnavailableError).attempts).toHaveLength(6);
    expect(calls).toEqual(['nvidia', 'nvidia', 'nvidia', 'groq', 'groq', 'groq']);
  });

  it('throws LlmUnavailableError when no provider is configured', async () => {
    const { llm } = setup({}, []);
    await expect(llm.chat({ messages: ask })).rejects.toBeInstanceOf(LlmUnavailableError);
  });

  it('honors Retry-After', async () => {
    const { llm, sleeps } = setup({
      nvidia: [{ status: 429, headers: { 'retry-after': '2' } }, { status: 200, body: completion('ok') }],
    });
    await llm.chat({ messages: ask });
    expect(sleeps).toEqual([2000]);
  });

  it('falls back immediately when Retry-After is too long', async () => {
    const { llm, calls, sleeps } = setup({
      nvidia: [{ status: 429, headers: { 'retry-after': '60' } }],
      groq: [{ status: 200, body: completion('ok') }],
    });
    await llm.chat({ messages: ask });
    expect(calls).toEqual(['nvidia', 'groq']);
    expect(sleeps).toEqual([]);
  });

  it('treats <unk> garbage output as a retryable failure', async () => {
    const { llm, calls } = setup({
      nvidia: [{ status: 200, body: completion('<unk><unk><unk>') }, { status: 200, body: completion('Clean') }],
    });
    const r = await llm.chat({ messages: ask });
    expect(r.text).toBe('Clean');
    expect(calls).toEqual(['nvidia', 'nvidia']);
  });

  it('strips <think> blocks from answers', async () => {
    const { llm } = setup({ nvidia: [{ status: 200, body: completion('<think>hmm</think>\nAnswer') }] });
    expect((await llm.chat({ messages: ask })).text).toBe('Answer');
  });

  it('uses the vision model when a message contains an image', async () => {
    const { llm, bodies } = setup({ nvidia: [{ status: 200, body: completion('A chart') }] });
    await llm.chat({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'describe' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
          ],
        },
      ],
    });
    expect(bodies[0]!.model).toBe('nvidia-vision');
  });

  it('turns NVIDIA reasoning off with enable_thinking=false', async () => {
    const { llm, bodies } = setup({ nvidia: [{ status: 200, body: completion('ok') }] });
    await llm.chat({ messages: ask, reasoning: 'off' });
    expect(bodies[0]!.chat_template_kwargs).toEqual({ enable_thinking: false });
  });
});

describe('chat with schema', () => {
  const schema = z.object({ answer: z.number() });

  it('parses JSON, tolerating code fences', async () => {
    const { llm } = setup({ nvidia: [{ status: 200, body: completion('```json\n{"answer": 42}\n```') }] });
    const r = await llm.chat({ messages: ask, schema });
    expect(r.data).toEqual({ answer: 42 });
  });

  it('repairs invalid JSON once', async () => {
    const { llm, calls } = setup({
      nvidia: [
        { status: 200, body: completion('{"answer": "forty-two"}') },
        { status: 200, body: completion('{"answer": 42}') },
      ],
    });
    const r = await llm.chat({ messages: ask, schema });
    expect(r.data).toEqual({ answer: 42 });
    expect(calls).toHaveLength(2);
  });
});

describe('chatStream', () => {
  async function collect(gen: AsyncGenerator<string, unknown>) {
    const parts: string[] = [];
    let r = await gen.next();
    while (!r.done) {
      parts.push(r.value);
      r = await gen.next();
    }
    return { parts, meta: r.value };
  }

  it('streams deltas with reasoning stripped', async () => {
    const { llm } = setup({
      nvidia: [{ status: 200, sse: [chunk('<thi'), chunk('nk>plan</think>\n'), chunk('Hello '), chunk('world')] }],
    });
    const { parts, meta } = await collect(llm.chatStream({ messages: ask }));
    expect(parts.join('')).toBe('Hello world');
    expect(meta).toEqual({ provider: 'nvidia', model: 'nvidia-text' });
  });

  it('falls back when a provider fails before the first token', async () => {
    const { llm, calls } = setup({
      nvidia: [{ status: 503 }],
      groq: [{ status: 200, sse: [chunk('Hi')] }],
    });
    const { parts, meta } = await collect(llm.chatStream({ messages: ask }));
    expect(parts.join('')).toBe('Hi');
    expect(meta).toMatchObject({ provider: 'groq' });
    expect(calls).toEqual(['nvidia', 'nvidia', 'nvidia', 'groq']);
  });
});
