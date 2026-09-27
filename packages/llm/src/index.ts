import { createLlm, type Llm } from './client';
import { providersFromEnv } from './providers';
import type { ChatParams, ChatResult, StreamMeta, StreamParams } from './types';

export { createLlm, type Llm } from './client';
export { providersFromEnv } from './providers';
export { LlmUnavailableError, LlmStreamError, LlmJsonError } from './errors';
export type * from './types';

let defaultLlm: Llm | undefined;

/** Lazily built from process.env so importing this module never throws. */
function llm(): Llm {
  defaultLlm ??= createLlm({ providers: providersFromEnv() });
  return defaultLlm;
}

/** One-shot completion through the provider chain (NVIDIA → Groq → OpenRouter). Server-only. */
export function chat<T = undefined>(params: ChatParams<T>): Promise<ChatResult<T>> {
  return llm().chat(params);
}

/** Streamed completion through the provider chain. Server-only. */
export function chatStream(params: StreamParams): AsyncGenerator<string, StreamMeta> {
  return llm().chatStream(params);
}
