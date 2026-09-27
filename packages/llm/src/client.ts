import OpenAI, { APIConnectionError, APIError, APIUserAbortError } from 'openai';
import { z } from 'zod';
import { BadOutputError, LlmJsonError, LlmStreamError, LlmUnavailableError } from './errors';
import { extractJson, isDegenerate, stripThinking, ThinkFilter } from './output';
import { reasoningFields } from './providers';
import type {
  CallLog,
  ChatParams,
  ChatResult,
  LlmOptions,
  Message,
  ProviderConfig,
  StreamMeta,
  StreamParams,
} from './types';

const BASE_BACKOFF_MS = 500;

type Failure = { retryable: boolean; status: number | string; retryAfterMs?: number };

class AttemptTimeout extends Error {}

function parseRetryAfter(headers: Headers | undefined): number | undefined {
  const v = headers?.get('retry-after');
  if (!v) return undefined;
  const secs = Number(v);
  if (Number.isFinite(secs)) return secs * 1000;
  const date = Date.parse(v);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function classify(err: unknown): Failure {
  if (err instanceof AttemptTimeout) return { retryable: true, status: 'timeout' };
  if (err instanceof BadOutputError) return { retryable: true, status: 'bad_output' };
  if (err instanceof APIConnectionError) return { retryable: true, status: 'network' };
  if (err instanceof APIError && typeof err.status === 'number') {
    const s = err.status;
    const retryable = s === 408 || s === 429 || s >= 500;
    return { retryable, status: s, retryAfterMs: parseRetryAfter(err.headers) };
  }
  return { retryable: true, status: err instanceof Error ? err.name : 'error' };
}

function usesImages(messages: Message[]): boolean {
  return messages.some(
    (m) => Array.isArray(m.content) && m.content.some((p) => typeof p === 'object' && p.type === 'image_url'),
  );
}

/** Adds the "reply with JSON only" instruction to the system prompt. */
function withJsonInstruction(messages: Message[], schema: z.ZodType): Message[] {
  const instruction =
    'Reply with only a JSON value that matches this JSON Schema. No prose, no code fences.\n' +
    JSON.stringify(z.toJSONSchema(schema));
  const [first, ...rest] = messages;
  if (first?.role === 'system' && typeof first.content === 'string') {
    return [{ role: 'system', content: `${first.content}\n\n${instruction}` }, ...rest];
  }
  return [{ role: 'system', content: instruction }, ...messages];
}

export function createLlm(options: LlmOptions) {
  const {
    providers,
    sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    logger = (log: CallLog) => console.info('[llm]', JSON.stringify(log)),
    attemptsPerProvider = 3,
    maxRetryWaitMs = 8000,
  } = options;

  const clients = new Map(
    providers.map((p) => [
      p.name,
      new OpenAI({
        apiKey: p.apiKey,
        baseURL: p.baseURL,
        maxRetries: 0, // retries are ours
        fetch: options.fetch,
        defaultHeaders: p.name === 'openrouter' ? { 'X-Title': 'Kalima' } : undefined,
      }),
    ]),
  );

  function modelFor(p: ProviderConfig, messages: Message[]) {
    return usesImages(messages) ? p.visionModel : p.textModel;
  }

  /** Per-attempt AbortController linked to the caller's signal, with a timeout that raises AttemptTimeout. */
  function attemptSignal(userSignal: AbortSignal | undefined, timeoutMs: number) {
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort(userSignal?.reason);
    userSignal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => ctrl.abort(new AttemptTimeout()), timeoutMs);
    return {
      signal: ctrl.signal,
      abort: () => ctrl.abort(),
      clear: () => {
        clearTimeout(timer);
        userSignal?.removeEventListener('abort', onAbort);
      },
      timedOut: () => ctrl.signal.reason instanceof AttemptTimeout,
    };
  }

  /**
   * Runs `op` through the provider chain: each provider gets `attemptsPerProvider` tries with
   * exponential backoff (honoring Retry-After); non-retryable errors skip to the next provider.
   */
  async function runChain<R>(
    userSignal: AbortSignal | undefined,
    timeoutMs: number,
    op: (p: ProviderConfig, client: OpenAI, signal: AbortSignal) => Promise<{ result: R; model: string }>,
  ): Promise<R> {
    const log: CallLog[] = [];
    for (const p of providers) {
      const client = clients.get(p.name)!;
      for (let attempt = 1; attempt <= attemptsPerProvider; attempt++) {
        const t0 = Date.now();
        const a = attemptSignal(userSignal, timeoutMs);
        try {
          const { result, model } = await op(p, client, a.signal);
          const entry = { provider: p.name, model, attempt, latency_ms: Date.now() - t0, ok: true };
          logger(entry);
          return result;
        } catch (raw) {
          if (userSignal?.aborted) throw raw;
          const err = a.timedOut() || raw instanceof APIUserAbortError ? new AttemptTimeout() : raw;
          const f = classify(err);
          const entry: CallLog = {
            provider: p.name,
            model: p.textModel,
            attempt,
            latency_ms: Date.now() - t0,
            ok: false,
            status: f.status,
            error: err instanceof Error ? err.message.slice(0, 160) : undefined,
          };
          logger(entry);
          log.push(entry);
          if (!f.retryable || attempt === attemptsPerProvider) break;
          const wait = f.retryAfterMs ?? BASE_BACKOFF_MS * 2 ** (attempt - 1);
          if (wait > maxRetryWaitMs) break;
          await sleep(wait);
        } finally {
          a.clear();
        }
      }
    }
    throw new LlmUnavailableError(log);
  }

  async function complete(
    messages: Message[],
    p: Omit<ChatParams<unknown>, 'messages' | 'schema'>,
  ): Promise<{ text: string; provider: ProviderConfig['name']; model: string }> {
    return runChain(p.signal, p.timeoutMs ?? 90_000, async (prov, client, signal) => {
      const model = modelFor(prov, messages);
      const body = {
        model,
        messages,
        temperature: p.temperature ?? 0.6,
        stream: false,
        ...reasoningFields(prov.name, model, p.reasoning ?? 'off', p.maxTokens ?? 2048),
      } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;
      const res = await client.chat.completions.create(body, { signal });
      const text = stripThinking(res.choices[0]?.message?.content ?? '');
      if (isDegenerate(text)) throw new BadOutputError();
      return { result: { text, provider: prov.name, model }, model };
    });
  }

  /** One-shot completion. With `schema`, the reply is parsed and validated (one repair retry). */
  async function chat<T = undefined>(params: ChatParams<T>): Promise<ChatResult<T>> {
    const { messages, schema, ...rest } = params;
    if (!schema) {
      const r = await complete(messages, rest);
      return { ...r, data: undefined as T };
    }

    const prompt = withJsonInstruction(messages, schema);
    const first = await complete(prompt, rest);
    const parsed = tryParse(schema, first.text);
    if (parsed.ok) return { ...first, data: parsed.data };

    const repair = await complete(
      [
        ...prompt,
        { role: 'assistant', content: first.text },
        {
          role: 'user',
          content: `That reply was not valid: ${parsed.error}. Reply again with only the corrected JSON.`,
        },
      ],
      rest,
    );
    const second = tryParse(schema, repair.text);
    if (second.ok) return { ...repair, data: second.data };
    throw new LlmJsonError(`Invalid JSON after repair: ${second.error}`, repair.text);
  }

  /**
   * Streams visible text deltas (reasoning stripped). Failures before the first visible token are
   * retried / fall back like chat(); a failure after text was sent throws LlmStreamError.
   * The generator's return value says which provider answered.
   */
  async function* chatStream(params: StreamParams): AsyncGenerator<string, StreamMeta> {
    const { messages } = params;
    let iterator!: AsyncIterator<OpenAI.Chat.Completions.ChatCompletionChunk>;
    let filter!: ThinkFilter;
    let abortStream!: () => void;

    const opened = await runChain(params.signal, params.firstTokenTimeoutMs ?? 30_000, async (prov, client, signal) => {
      const model = modelFor(prov, messages);
      const body = {
        model,
        messages,
        temperature: params.temperature ?? 0.6,
        stream: true,
        ...reasoningFields(prov.name, model, params.reasoning ?? 'off', params.maxTokens ?? 2048),
      } as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming;
      // The chain's timeout only covers opening + first token, so the rest of the stream gets its own controller.
      const streamCtrl = new AbortController();
      signal.addEventListener('abort', () => streamCtrl.abort(signal.reason), { once: true });
      const stream = await client.chat.completions.create(body, { signal: streamCtrl.signal });
      const it = stream[Symbol.asyncIterator]();
      const f = new ThinkFilter();
      let first = '';
      for (;;) {
        const { value, done } = await it.next();
        if (done) {
          first = f.flush().trimStart();
          break;
        }
        first = f.push(value.choices[0]?.delta?.content ?? '').trimStart();
        if (first) break;
      }
      if (isDegenerate(first)) {
        streamCtrl.abort();
        throw new BadOutputError();
      }
      // Detach from the attempt timeout now that text is flowing; keep the caller's abort.
      params.signal?.addEventListener('abort', () => streamCtrl.abort(params.signal?.reason), { once: true });
      return { result: { first, it, f, abort: () => streamCtrl.abort(), meta: { provider: prov.name, model } }, model };
    });

    iterator = opened.it;
    filter = opened.f;
    abortStream = opened.abort;
    let finished = false;
    try {
      yield opened.first;
      for (;;) {
        let next: IteratorResult<OpenAI.Chat.Completions.ChatCompletionChunk>;
        try {
          next = await iterator.next();
        } catch (err) {
          if (params.signal?.aborted) throw err;
          throw new LlmStreamError('Stream interrupted after text was sent', { cause: err });
        }
        if (next.done) break;
        const text = filter.push(next.value.choices[0]?.delta?.content ?? '');
        if (text.includes('<unk>')) throw new LlmStreamError('Degenerate output mid-stream');
        if (text) yield text;
      }
      const tail = filter.flush();
      if (tail) yield tail;
      finished = true;
      return opened.meta;
    } finally {
      if (!finished) abortStream();
    }
  }

  return { chat, chatStream };
}

function tryParse<T>(schema: z.ZodType<T>, text: string): { ok: true; data: T } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = extractJson(text);
  } catch (e) {
    return { ok: false, error: `not JSON (${(e as Error).message})` };
  }
  const r = schema.safeParse(json);
  return r.success ? { ok: true, data: r.data } : { ok: false, error: z.prettifyError(r.error) };
}

export type Llm = ReturnType<typeof createLlm>;
