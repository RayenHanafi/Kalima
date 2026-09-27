import type { QuizQuestion } from './types';

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const TRUE_WORDS = new Set(['true', 'vrai', 'yes', 'oui', 'correct', 'juste', 'v', 't']);
const FALSE_WORDS = new Set(['false', 'faux', 'no', 'non', 'incorrect', 'f']);

const LETTERS = ['a', 'b', 'c', 'd', 'e'];

/**
 * Maps a spoken or typed answer ("B", "option b", "2", "vrai", or the option text) to the
 * option it picks. Returns null when it can't tell — the LLM grader then decides.
 */
export function resolveChoice(q: Pick<QuizQuestion, 'type' | 'options'>, raw: string): string | null {
  const a = normalize(raw);
  if (!a) return null;

  if (q.type === 'true_false') {
    const first = a.split(' ')[0]!;
    if (TRUE_WORDS.has(a) || TRUE_WORDS.has(first)) return q.options[0] ?? 'true';
    if (FALSE_WORDS.has(a) || FALSE_WORDS.has(first)) return q.options[1] ?? 'false';
  }

  const byText = q.options.find((o) => normalize(o) === a);
  if (byText) return byText;

  const m = a.match(/^(?:option|reponse|answer|lettre|letter)?\s*([a-e]|[1-5])$/);
  if (m) {
    const token = m[1]!;
    const idx = /\d/.test(token) ? Number(token) - 1 : LETTERS.indexOf(token);
    return q.options[idx] ?? null;
  }
  return null;
}

/** Deterministic grading for multiple choice and true/false; null for short answers or unclear input. */
export function gradeChoice(q: QuizQuestion, raw: string): boolean | null {
  if (q.type === 'short') return null;
  const picked = resolveChoice(q, raw);
  if (picked === null) return null;
  return normalize(picked) === normalize(q.answer);
}
