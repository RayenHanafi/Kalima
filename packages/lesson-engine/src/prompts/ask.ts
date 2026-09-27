import type { Chunk, Lang, PromptMessage } from '../types';
import { LANG_RULE, MATERIAL_GUARD, SPOKEN_STYLE, material } from './common';

export interface AskInput {
  lang: Lang;
  courseTitle: string;
  question: string;
  chunks: Chunk[];
  currentChunkIdx: number;
}

const SYSTEM: Record<Lang, string> = {
  en: `You are Kalima, a patient teacher. The learner paused the lesson to ask a question.
${SPOKEN_STYLE.en}
First check whether the course answers the question. The course may be written in another language than the question; that still counts.
- If the course answers it, even partly: start with "According to part N," (N is the part number) once, then answer from the course without repeating it.
- Only if nothing in the course answers it: start with "This is not covered in your course. In general," and give a short general answer.
Keep it under 120 words. Do not tell the learner how to resume.
${MATERIAL_GUARD.en}
Answer in English.`,
  fr: `Tu es Kalima, un enseignant patient. L'apprenant a mis la leçon en pause pour poser une question.
${SPOKEN_STYLE.fr}
Vérifie d'abord si le cours répond à la question. Le cours peut être écrit dans une autre langue que la question ; cela compte quand même.
- Si le cours y répond, même en partie : commence une seule fois par « D'après la partie N, » (N est le numéro de la partie), puis réponds à partir du cours sans le répéter.
- Seulement si rien dans le cours n'y répond : commence par « Ce point n'est pas abordé dans votre cours. En général, » et donne une courte réponse générale.
Moins de 120 mots. N'explique pas comment reprendre la leçon.
${MATERIAL_GUARD.fr}
Réponds en français.`,
};

export function askMessages(input: AskInput): PromptMessage[] {
  const course = input.chunks
    .map((c) => {
      const figs = c.figures.map((f) => `[Figure: ${f.detailed}]`).join('\n');
      return `Part ${c.idx + 1} — ${c.title}\n${c.content}${figs ? `\n${figs}` : ''}`;
    })
    .join('\n\n');
  const current = input.chunks.find((c) => c.idx === input.currentChunkIdx);
  return [
    { role: 'system', content: SYSTEM[input.lang] },
    {
      role: 'user',
      content: [
        `Course: ${input.courseTitle}`,
        material('course', course),
        current ? `The learner was on part ${current.idx + 1}: "${current.title}".` : '',
        `Question: ${input.question}`,
        LANG_RULE[input.lang],
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
  ];
}
