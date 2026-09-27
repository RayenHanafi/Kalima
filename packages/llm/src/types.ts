import type OpenAI from 'openai';
import type { ZodType } from 'zod';

export type ProviderName = 'nvidia' | 'groq' | 'openrouter';

/** How much the model may "think" before answering. Latency-sensitive tasks use 'off' or 'low'. */
export type Reasoning = 'off' | 'low' | 'high';

export type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export interface ProviderConfig {
  name: ProviderName;
  baseURL: string;
  apiKey: string;
  textModel: string;
  visionModel: string;
}

/** One attempt against one provider. Never contains prompt or output content. */
export interface CallLog {
  provider: ProviderName;
  model: string;
  attempt: number;
  latency_ms: number;
  ok: boolean;
  status?: number | string;
}

export interface LlmOptions {
  providers: ProviderConfig[];
  /** Injected for tests; defaults to global fetch. */
  fetch?: typeof fetch;
  /** Injected for tests; defaults to setTimeout-based sleep. */
  sleep?: (ms: number) => Promise<void>;
  logger?: (log: CallLog) => void;
  /** Attempts per provider before falling to the next one. */
  attemptsPerProvider?: number;
  /** Retry-After longer than this skips straight to the next provider. */
  maxRetryWaitMs?: number;
}

export interface ChatParams<T> {
  messages: Message[];
  /** When set, the reply must be JSON matching this schema (one repair retry). */
  schema?: ZodType<T>;
  reasoning?: Reasoning;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  /** Per-attempt timeout. Default 90s. */
  timeoutMs?: number;
}

export interface ChatResult<T> {
  text: string;
  data: T;
  provider: ProviderName;
  model: string;
}

export interface StreamParams {
  messages: Message[];
  reasoning?: Reasoning;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  /** Max wait for the first visible token, per attempt. Default 30s. */
  firstTokenTimeoutMs?: number;
}

export interface StreamMeta {
  provider: ProviderName;
  model: string;
}
