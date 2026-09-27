import { z } from 'zod';
import type { Lang, PromptMessage } from '../types';
import { LANG_RULE, MATERIAL_GUARD, SPOKEN_STYLE, material } from './common';

export const ImageDescriptionSchema = z.object({
  short: z.string().min(1).describe('One sentence, at most 25 words: what the image is and its main message'),
  detailed: z
    .string()
    .min(1)
    .describe('3 to 6 spoken sentences: structure, every label and value, relationships, and what it teaches'),
});
export type ImageDescription = z.infer<typeof ImageDescriptionSchema>;

const SYSTEM: Record<Lang, string> = {
  en: `You describe educational images (diagrams, charts, schemas, equations, slides) for blind learners.
Say what kind of image it is, then its content: every label, value, axis, step or arrow that matters, and how parts relate.
End the detailed description with what the image teaches. Read any text in the image exactly. Do not guess what you cannot see.
${SPOKEN_STYLE.en}
${MATERIAL_GUARD.en}
Write in English.`,
  fr: `Tu décris des images pédagogiques (schémas, graphiques, diagrammes, équations, diapositives) pour des personnes aveugles.
Dis quel type d'image c'est, puis son contenu : chaque étiquette, valeur, axe, étape ou flèche importante, et les relations entre les parties.
Termine la description détaillée par ce que l'image enseigne. Lis exactement le texte présent dans l'image. Ne devine pas ce que tu ne vois pas.
${SPOKEN_STYLE.fr}
${MATERIAL_GUARD.fr}
Écris en français.`,
};

export function describeImageMessages(input: { lang: Lang; imageUrl: string; context?: string }): PromptMessage[] {
  const context = input.context?.trim() ? `Surrounding course text:\n${material('context', input.context.trim())}\n\n` : '';
  return [
    { role: 'system', content: SYSTEM[input.lang] },
    {
      role: 'user',
      content: [
        { type: 'text', text: `${context}Describe this image. ${LANG_RULE[input.lang]}` },
        { type: 'image_url', image_url: { url: input.imageUrl } },
      ],
    },
  ];
}
