import type { CallLog } from './types';

/** Every provider failed (or none is configured). */
export class LlmUnavailableError extends Error {
  constructor(readonly attempts: CallLog[]) {
    super(
      attempts.length
        ? `All AI providers failed (${attempts.map((a) => `${a.provider}#${a.attempt}:${a.status}`).join(', ')})`
        : 'No AI provider is configured (set NVIDIA_API_KEY, GROQ_API_KEY or OPENROUTER_API_KEY)',
    );
    this.name = 'LlmUnavailableError';
  }
}

/** The stream broke after text was already sent to the user; the client resumes from its last sentence. */
export class LlmStreamError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LlmStreamError';
  }
}

/** The reply did not match the requested schema, even after one repair retry. */
export class LlmJsonError extends Error {
  constructor(message: string, readonly raw: string) {
    super(message);
    this.name = 'LlmJsonError';
  }
}

/** Empty or garbage output; treated like a server error (retry, then fall back). */
export class BadOutputError extends Error {
  constructor(message = 'empty or degenerate model output') {
    super(message);
    this.name = 'BadOutputError';
  }
}
