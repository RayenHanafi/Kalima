import type { Chunk, Lang, LessonMode, PromptMessage } from '../types';
import { LANG_RULE, MATERIAL_GUARD, SPOKEN_STYLE, material } from './common';

export type DetailLevel = 'short' | 'normal' | 'detailed';

export interface Mistake {
  question: string;
  learnerAnswer: string;
  correctAnswer: string;
}

export interface ExplainInput {
  lang: Lang;
  courseTitle: string;
  outline: string[];
  chunk: Chunk;
  chunkCount: number;
  mode: LessonMode;
  detail?: DetailLevel;
  /** Review mode: the quiz mistakes linked to this chunk. */
  mistakes?: Mistake[];
}

const LENGTH: Record<DetailLevel, string> = {
  short: '80 to 120 words',
  normal: '130 to 220 words',
  detailed: '220 to 350 words',
};

const SYSTEM: Record<Lang, string> = {
  en: `You are Kalima, a warm and patient teacher. You explain a course part by part, out loud.
${SPOKEN_STYLE.en}
Teach only what is in the given part; you may add one short everyday example if it helps. Do not invent facts.
When the part has figures, describe what each one shows, in context, as part of the explanation ("The diagram shows…").
Never start with a greeting such as "Hello" and never say goodbye. Do not ask the learner to press anything.
${MATERIAL_GUARD.en}
Answer in English.`,
  fr: `Tu es Kalima, un enseignant chaleureux et patient. Tu expliques un cours partie par partie, à voix haute.
${SPOKEN_STYLE.fr}
Enseigne uniquement ce qui est dans la partie donnée ; tu peux ajouter un court exemple du quotidien si cela aide. N'invente pas de faits.
Quand la partie contient des figures, décris ce que chacune montre, dans le contexte, au fil de l'explication (« Le schéma montre… »).
Ne commence jamais par une salutation comme « Bonjour » et ne dis pas au revoir. Ne demande pas d'appuyer sur quoi que ce soit.
${MATERIAL_GUARD.fr}
Réponds en français.`,
};

export function explainMessages(input: ExplainInput): PromptMessage[] {
  const { chunk, lang } = input;
  const position = `Part ${chunk.idx + 1} of ${input.chunkCount}: "${chunk.title}"`;
  const figures = chunk.figures.length
    ? `\nFigures in this part:\n${chunk.figures.map((f) => `- ${f.detailed}`).join('\n')}`
    : '';

  const task =
    input.mode === 'review'
      ? `The learner made mistakes on this part in the quiz. Re-explain it differently and more simply, focusing on what they got wrong, and say clearly what the right answer is and why.\nMistakes:\n${(input.mistakes ?? [])
          .map((m) => `- Question: ${m.question} | Learner answered: ${m.learnerAnswer} | Correct: ${m.correctAnswer}`)
          .join('\n')}`
      : chunk.idx === 0
        ? 'This is the first part: start with one sentence saying what the course is about, then teach this part.'
        : chunk.idx === input.chunkCount - 1
          ? 'This is the last part: teach it, then end with one sentence summing up the whole course.'
          : 'Teach this part, then end with one short sentence that leads to the next part.';

  return [
    { role: 'system', content: SYSTEM[lang] },
    {
      role: 'user',
      content: [
        `Course: ${input.courseTitle}`,
        material('outline', input.outline.map((t, i) => `${i + 1}. ${t}`).join('\n')),
        position,
        material('chunk', chunk.content + figures),
        `${task}\nLength: ${LENGTH[input.detail ?? 'normal']}.`,
        LANG_RULE[lang],
      ].join('\n\n'),
    },
  ];
}
