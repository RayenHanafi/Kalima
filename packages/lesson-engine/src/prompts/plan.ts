import { z } from 'zod';
import type { Block } from '../text';
import type { Lang, PromptMessage } from '../types';
import { LANG_RULE, MATERIAL_GUARD, material } from './common';

export const PlanSchema = z.object({
  title: z.string().min(1).describe('Short course title in the course language'),
  chunks: z
    .array(
      z.object({
        title: z.string().min(1).describe('Short title of this part, in the course language'),
        startBlock: z.number().int().min(0).describe('Number of the first block of this part'),
        endBlock: z.number().int().min(0).describe('Number of the last block of this part'),
      }),
    )
    .min(1),
});
export type Plan = z.infer<typeof PlanSchema>;

const SYSTEM: Record<Lang, string> = {
  en: `You are an expert teacher preparing a course to be taught aloud, one part at a time, to a blind learner.
The course is split into numbered blocks like [b3]. Group consecutive blocks into teachable parts.
Rules:
- Keep the original order. Every block belongs to exactly one part. Parts do not overlap.
- One main idea per part, roughly 120 to 400 words of source text each. A figure block stays with the text it illustrates.
- Give each part a short, clear title a learner can navigate by.
- Give the whole course a short title.
${MATERIAL_GUARD.en}`,
  fr: `Tu es un enseignant expert qui prépare un cours pour l'enseigner à voix haute, partie par partie, à une personne aveugle.
Le cours est découpé en blocs numérotés comme [b3]. Regroupe des blocs consécutifs en parties enseignables.
Règles :
- Garde l'ordre d'origine. Chaque bloc appartient à une seule partie. Les parties ne se chevauchent pas.
- Une idée principale par partie, environ 120 à 400 mots de texte source chacune. Un bloc de figure reste avec le texte qu'il illustre.
- Donne à chaque partie un titre court et clair pour s'y retrouver.
- Donne au cours entier un titre court.
${MATERIAL_GUARD.fr}`,
};

export function planMessages(input: { lang: Lang; title?: string | null; blocks: Block[] }): PromptMessage[] {
  const body = input.blocks
    .map((b) => `[b${b.n}]${b.kind === 'figure' ? ` (figure, page ${b.pageNo})` : ''} ${b.text}`)
    .join('\n\n');
  const header = input.title ? `Title: ${input.title}\n` : '';
  return [
    { role: 'system', content: SYSTEM[input.lang] },
    {
      role: 'user',
      content: `${header}Blocks b0 to b${input.blocks.length - 1}:\n${material('course', body)}\n\nTitles: ${LANG_RULE[input.lang]}`,
    },
  ];
}
