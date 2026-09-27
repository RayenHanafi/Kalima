import type { ProviderConfig, ProviderName, Reasoning } from './types';

const DEFAULTS: Record<ProviderName, { baseURL: string; model: string }> = {
  nvidia: {
    baseURL: 'https://integrate.api.nvidia.com/v1',
    model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
  },
  groq: { baseURL: 'https://api.groq.com/openai/v1', model: 'qwen/qwen3.8-27b' },
  openrouter: {
    baseURL: 'https://openrouter.ai/api/v1',
    model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
  },
};

type Env = Record<string, string | undefined>;

function configFor(name: ProviderName, env: Env): ProviderConfig | null {
  const d = DEFAULTS[name];
  switch (name) {
    case 'nvidia': {
      if (!env.NVIDIA_API_KEY) return null;
      const text = env.NV_MODEL_TEXT || d.model;
      return {
        name,
        baseURL: env.NVIDIA_BASE_URL || d.baseURL,
        apiKey: env.NVIDIA_API_KEY,
        textModel: text,
        visionModel: env.NV_MODEL_VISION || text,
      };
    }
    case 'groq': {
      if (!env.GROQ_API_KEY) return null;
      const model = env.GROQ_MODEL || d.model;
      return { name, baseURL: d.baseURL, apiKey: env.GROQ_API_KEY, textModel: model, visionModel: model };
    }
    case 'openrouter': {
      if (!env.OPENROUTER_API_KEY) return null;
      const model = env.OPENROUTER_MODEL || d.model;
      return { name, baseURL: d.baseURL, apiKey: env.OPENROUTER_API_KEY, textModel: model, visionModel: model };
    }
  }
}

/** Providers in LLM_PROVIDERS order; providers without an API key are skipped. */
export function providersFromEnv(env: Env = process.env): ProviderConfig[] {
  const order = (env.LLM_PROVIDERS || 'nvidia,groq,openrouter')
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is ProviderName => s in DEFAULTS);
  return order.map((n) => configFor(n, env)).filter((p): p is ProviderConfig => p !== null);
}

const BUDGET = { low: 1024, high: 8192 } as const;

/** Provider-specific request fields that control reasoning. `maxTokens` is the answer budget. */
export function reasoningFields(
  provider: ProviderName,
  model: string,
  reasoning: Reasoning,
  maxTokens: number,
): Record<string, unknown> {
  switch (provider) {
    case 'nvidia':
      // Verified live: enable_thinking=false disables reasoning on Nemotron 3 Nano Omni.
      return reasoning === 'off'
        ? { max_tokens: maxTokens, chat_template_kwargs: { enable_thinking: false } }
        : { max_tokens: maxTokens + BUDGET[reasoning], reasoning_budget: BUDGET[reasoning] };
    case 'groq':
      if (model.startsWith('qwen/')) {
        return { max_tokens: maxTokens, reasoning_effort: reasoning === 'off' ? 'none' : 'default' };
      }
      if (model.startsWith('openai/gpt-oss')) {
        return { max_tokens: maxTokens, reasoning_effort: reasoning === 'high' ? 'high' : 'low' };
      }
      return { max_tokens: maxTokens };
    case 'openrouter':
      return reasoning === 'off'
        ? { max_tokens: maxTokens, reasoning: { enabled: false } }
        : { max_tokens: maxTokens + BUDGET[reasoning], reasoning: { max_tokens: BUDGET[reasoning] } };
  }
}
