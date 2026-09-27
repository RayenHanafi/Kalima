import { z } from 'zod';
import type { Chunk, Lang, PromptMessage } from '../types';
import { LANG_RULE, MATERIAL_GUARD, material } from './common';

export const QuizSchema = z.object({
  questions: z
    .array(
      z.object({
        type: z.enum(['mcq', 'true_false', 'short']),
        question: z.string().min(1).describe('Short question, easy to understand when heard once'),
        options: z
          .array(z.string())
          .describe('mcq: 3 or 4 short options; true_false: exactly the two labels; short: empty array'),
        answer: z.string().min(1).describe('mcq/true_false: exactly one of the options; short: the expected answer'),
        part: z.number().int().min(1).describe('Number of the course part this question tests'),
      }),
    )
    .min(3)
    .max(10),
});
export type QuizDraft = z.infer<typeof QuizSchema>;

const TF_LABELS: Record<Lang, [string, string]> = { en: ['True', 'False'], fr: ['Vrai', 'Faux'] };
export const trueFalseLabels = (lang: Lang) => TF_LABELS[lang];

const SYSTEM: Record<Lang, string> = {
  en: `You write short oral quizzes for blind learners, who will hear each question and its options once.
Write 5 to 8 questions that check understanding of the main ideas (not trivia), covering the parts evenly.
Mix types: mostly multiple choice (3 or 4 short options, one correct), a couple of true/false (options exactly "True" and "False"), and at most one short-answer question.
Options must be short and clearly different when heard. Never use "all of the above" or "none of the above".
Only ask about what is in the course.
${MATERIAL_GUARD.en}
Write in English.`,
  fr: `Tu écris de courts quiz oraux pour des personnes aveugles, qui entendront chaque question et ses options une seule fois.
Écris 5 à 8 questions qui vérifient la compréhension des idées principales (pas des détails), réparties sur les parties.
Mélange les types : surtout des QCM (3 ou 4 options courtes, une seule correcte), deux vrai/faux (options exactement « Vrai » et « Faux »), et au plus une question à réponse courte.
Les options doivent être courtes et bien distinctes à l'oral. N'utilise jamais « toutes les réponses » ou « aucune réponse ».
Ne pose des questions que sur le contenu du cours.
${MATERIAL_GUARD.fr}
Écris en français.`,
};

export function quizMessages(input: { lang: Lang; courseTitle: string; chunks: Chunk[] }): PromptMessage[] {
  const course = input.chunks.map((c) => `Part ${c.idx + 1} — ${c.title}\n${c.content}`).join('\n\n');
  return [
    { role: 'system', content: SYSTEM[input.lang] },
    { role: 'user', content: `Course: ${input.courseTitle}\n\n${material('course', course)}\n\n${LANG_RULE[input.lang]}` },
  ];
}
