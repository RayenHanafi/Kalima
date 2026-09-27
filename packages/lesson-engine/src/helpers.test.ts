import { describe, expect, it } from 'vitest';
import { gradeChoice, resolveChoice } from './grading';
import { assembleChunks } from './plan';
import { askMessages } from './prompts/ask';
import { describeImageMessages } from './prompts/describe-image';
import { explainMessages } from './prompts/explain';
import { splitSentences, stripGreeting, toBlocks } from './text';
import type { Chunk, FigureDescription, QuizQuestion } from './types';

describe('splitSentences', () => {
  it('splits on sentence ends, keeps abbreviations-free text intact', () => {
    expect(splitSentences('Hello there. How are you? Fine!  «Bien» dit-il.')).toEqual([
      'Hello there.',
      'How are you?',
      'Fine!',
      '«Bien» dit-il.',
    ]);
  });

  it('does not split decimals', () => {
    expect(splitSentences('It measures 2.5 cm. Then it grows.')).toEqual(['It measures 2.5 cm.', 'Then it grows.']);
  });
});

describe('stripGreeting', () => {
  it('drops a leading greeting only', () => {
    expect(stripGreeting('Bonjour. Ce cours porte sur…')).toBe('Ce cours porte sur…');
    expect(stripGreeting('Hello everyone! Today we…')).toBe('Today we…');
    expect(stripGreeting('Salut, la mitose…')).toBe('la mitose…');
    expect(stripGreeting('Bonjour est un mot.')).toBe('Bonjour est un mot.');
    expect(stripGreeting('La cellule dit bonjour.')).toBe('La cellule dit bonjour.');
  });
});

describe('toBlocks + assembleChunks', () => {
  const long = (w: string) => `${w} `.repeat(60).trim();
  const pages = [
    { pageNo: 1, text: `${long('alpha')}\n\n${long('beta')}`, figures: [{ ref: 'p1-f1', short: 's', detailed: 'A diagram.' }] },
    { pageNo: 2, text: long('gamma'), figures: [] },
  ];
  const blocks = toBlocks(pages);
  const figs = new Map<string, FigureDescription>([['p1-f1', { ref: 'p1-f1', short: 's', detailed: 'A diagram.' }]]);

  it('numbers blocks in page order with figures after their page text', () => {
    expect(blocks.map((b) => [b.id, b.pageNo, b.kind])).toEqual([
      ['b0', 1, 'text'],
      ['b1', 1, 'text'],
      ['b2', 1, 'figure'],
      ['b3', 2, 'text'],
    ]);
  });

  it('covers every block once even when the plan has gaps, overlaps and bad order', () => {
    const chunks = assembleChunks(
      blocks,
      [
        { title: 'Second', startBlock: 3, endBlock: 3 },
        { title: 'First', startBlock: 1, endBlock: 9 },
      ],
      figs,
    );
    expect(chunks.map((c) => c.title)).toEqual(['First', 'Second']);
    expect(chunks[0]!.content).toContain('alpha'); // b0 was missing → merged into the first chunk
    expect(chunks[0]!.content).toContain('beta');
    expect(chunks[0]!.figures).toEqual([{ ref: 'p1-f1', short: 's', detailed: 'A diagram.' }]);
    expect(chunks[0]!.pageRef).toBe('1');
    expect(chunks[1]!.content).toContain('gamma');
  });

  it('falls back to a single chunk when the plan is empty', () => {
    expect(assembleChunks(blocks, [], figs)).toHaveLength(1);
  });
});

describe('grading', () => {
  const mcq: QuizQuestion = {
    id: 'q1',
    type: 'mcq',
    question: 'Which?',
    options: ['Chloroplast', 'Nucleus', 'Ribosome'],
    answer: 'Chloroplast',
    chunkIdx: 0,
    chunkId: 'c0',
  };
  const tf: QuizQuestion = { ...mcq, id: 'q2', type: 'true_false', options: ['Vrai', 'Faux'], answer: 'Faux' };

  it('accepts letters, numbers, "option x" and option text', () => {
    expect(resolveChoice(mcq, 'A')).toBe('Chloroplast');
    expect(resolveChoice(mcq, 'option b')).toBe('Nucleus');
    expect(resolveChoice(mcq, '3')).toBe('Ribosome');
    expect(resolveChoice(mcq, 'chloroplast.')).toBe('Chloroplast');
    expect(resolveChoice(mcq, 'maybe the green thing')).toBeNull();
  });

  it('grades multiple choice and true/false in FR and EN', () => {
    expect(gradeChoice(mcq, 'a')).toBe(true);
    expect(gradeChoice(mcq, 'b')).toBe(false);
    expect(gradeChoice(tf, 'faux')).toBe(true);
    expect(gradeChoice(tf, 'False')).toBe(true);
    expect(gradeChoice(tf, 'oui')).toBe(false);
  });

  it('leaves short answers to the model', () => {
    expect(gradeChoice({ ...mcq, type: 'short', options: [] }, 'light')).toBeNull();
  });
});

describe('prompt builders', () => {
  const chunk: Chunk = { id: 'c0', idx: 0, title: 'Intro', content: 'Plants make food.', figures: [], pageRef: '1' };

  it('explain: FR and EN system prompts, first chunk intro, material tags', () => {
    const en = explainMessages({ lang: 'en', courseTitle: 'Bio', outline: ['Intro'], chunk, chunkCount: 3, mode: 'normal' });
    const fr = explainMessages({ lang: 'fr', courseTitle: 'Bio', outline: ['Intro'], chunk, chunkCount: 3, mode: 'normal' });
    expect(en[0]!.content).toContain('Answer in English.');
    expect(fr[0]!.content).toContain('Réponds en français.');
    expect(String(en[1]!.content)).toContain('<chunk>\nPlants make food.');
    expect(String(en[1]!.content)).toContain('This is the first part');
  });

  it('explain review mode lists the mistakes', () => {
    const m = explainMessages({
      lang: 'en',
      courseTitle: 'Bio',
      outline: ['Intro'],
      chunk,
      chunkCount: 1,
      mode: 'review',
      mistakes: [{ question: 'Q?', learnerAnswer: 'x', correctAnswer: 'y' }],
    });
    expect(String(m[1]!.content)).toContain('Learner answered: x | Correct: y');
  });

  it('ask includes the whole course and the question', () => {
    const m = askMessages({ lang: 'fr', courseTitle: 'Bio', question: 'Pourquoi ?', chunks: [chunk], currentChunkIdx: 0 });
    expect(String(m[1]!.content)).toContain('Plants make food.');
    expect(String(m[1]!.content)).toContain('Question: Pourquoi ?');
  });

  it('describe-image sends the image as image_url', () => {
    const m = describeImageMessages({ lang: 'en', imageUrl: 'data:image/png;base64,AA', context: 'Mitosis' });
    const parts = m[1]!.content as Array<{ type: string }>;
    expect(parts.map((p) => p.type)).toEqual(['text', 'image_url']);
  });
});
