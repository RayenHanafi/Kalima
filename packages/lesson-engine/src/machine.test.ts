import { describe, expect, it } from 'vitest';
import { initialState, next } from './machine';
import type { LessonEvent, LessonState } from './types';

const run = (s: LessonState, ...events: LessonEvent[]) => events.reduce(next, s);
const explaining = (chunkCount = 3): LessonState =>
  run(initialState(), { type: 'INGESTED' }, { type: 'PLANNED', chunkCount });

describe('ingest → plan', () => {
  it('INGESTING + INGESTED → PLANNING', () => {
    expect(next(initialState(), { type: 'INGESTED' }).status).toBe('PLANNING');
  });

  it('PLANNING + PLANNED → EXPLAINING at chunk 0', () => {
    const s = explaining(3);
    expect(s).toMatchObject({ status: 'EXPLAINING', mode: 'normal', chunkCount: 3, position: { chunkIdx: 0, sentenceOffset: 0 } });
  });

  it('PLANNED with zero chunks is ignored', () => {
    const s = next(initialState(), { type: 'INGESTED' });
    expect(next(s, { type: 'PLANNED', chunkCount: 0 })).toBe(s);
  });
});

describe('EXPLAINING', () => {
  it('SENTENCE_SPOKEN updates the sentence offset', () => {
    expect(next(explaining(), { type: 'SENTENCE_SPOKEN', sentenceOffset: 4 }).position).toEqual({ chunkIdx: 0, sentenceOffset: 4 });
  });

  it('CHUNK_DONE moves to the next chunk at sentence 0', () => {
    const s = run(explaining(), { type: 'SENTENCE_SPOKEN', sentenceOffset: 4 }, { type: 'CHUNK_DONE' });
    expect(s.position).toEqual({ chunkIdx: 1, sentenceOffset: 0 });
  });

  it('CHUNK_DONE on the last chunk → QUIZ', () => {
    const s = run(explaining(2), { type: 'CHUNK_DONE' }, { type: 'CHUNK_DONE' });
    expect(s.status).toBe('QUIZ');
  });

  it('NEXT behaves like CHUNK_DONE', () => {
    expect(next(explaining(), { type: 'NEXT' }).position.chunkIdx).toBe(1);
  });

  it('PREVIOUS goes back one chunk, never below 0', () => {
    expect(run(explaining(), { type: 'NEXT' }, { type: 'PREVIOUS' }).position.chunkIdx).toBe(0);
    expect(next(explaining(), { type: 'PREVIOUS' }).position.chunkIdx).toBe(0);
  });

  it('REPEAT restarts the current chunk', () => {
    const s = run(explaining(), { type: 'NEXT' }, { type: 'SENTENCE_SPOKEN', sentenceOffset: 3 }, { type: 'REPEAT' });
    expect(s.position).toEqual({ chunkIdx: 1, sentenceOffset: 0 });
  });

  it('GOTO jumps to a valid chunk and ignores invalid ones', () => {
    expect(next(explaining(), { type: 'GOTO', chunkIdx: 2 }).position).toEqual({ chunkIdx: 2, sentenceOffset: 0 });
    const s = explaining();
    expect(next(s, { type: 'GOTO', chunkIdx: 9 })).toBe(s);
  });

  it('GOTO from PAUSED resumes explaining at that chunk', () => {
    const s = run(explaining(), { type: 'STOP', sentenceOffset: 1 }, { type: 'GOTO', chunkIdx: 1 });
    expect(s).toMatchObject({ status: 'EXPLAINING', position: { chunkIdx: 1, sentenceOffset: 0 } });
  });

  it('STOP → PAUSED and remembers the sentence', () => {
    const s = next(explaining(), { type: 'STOP', sentenceOffset: 2 });
    expect(s).toMatchObject({ status: 'PAUSED', position: { chunkIdx: 0, sentenceOffset: 2 } });
  });

  it('ASK → ANSWERING', () => {
    expect(next(explaining(), { type: 'ASK' }).status).toBe('ANSWERING');
  });

  it('ignores events that do not apply', () => {
    const s = explaining();
    expect(next(s, { type: 'CONTINUE' })).toBe(s);
    expect(next(s, { type: 'EVALUATED', weakChunkIdxs: [] })).toBe(s);
  });
});

describe('PAUSED and ANSWERING', () => {
  const paused = () => next(explaining(), { type: 'STOP', sentenceOffset: 2 });

  it('CONTINUE resumes at the same sentence', () => {
    expect(next(paused(), { type: 'CONTINUE' })).toMatchObject({ status: 'EXPLAINING', position: { chunkIdx: 0, sentenceOffset: 2 } });
  });

  it('ASK from PAUSED → ANSWERING, ANSWERED → PAUSED (waits for continue), position kept', () => {
    const s = run(paused(), { type: 'ASK' });
    expect(s.status).toBe('ANSWERING');
    expect(next(s, { type: 'ANSWERED' })).toMatchObject({ status: 'PAUSED', position: { chunkIdx: 0, sentenceOffset: 2 } });
  });

  it('NEXT / PREVIOUS / REPEAT from PAUSED resume explaining', () => {
    expect(next(paused(), { type: 'NEXT' })).toMatchObject({ status: 'EXPLAINING', position: { chunkIdx: 1, sentenceOffset: 0 } });
    expect(next(paused(), { type: 'PREVIOUS' })).toMatchObject({ status: 'EXPLAINING', position: { chunkIdx: 0, sentenceOffset: 0 } });
    expect(next(paused(), { type: 'REPEAT' })).toMatchObject({ status: 'EXPLAINING', position: { chunkIdx: 0, sentenceOffset: 0 } });
  });

  it('NEXT from PAUSED on the last chunk → QUIZ', () => {
    const s = run(explaining(1), { type: 'STOP', sentenceOffset: 0 }, { type: 'NEXT' });
    expect(s.status).toBe('QUIZ');
  });

  it('ANSWERING ignores everything but ANSWERED', () => {
    const s = next(explaining(), { type: 'ASK' });
    expect(next(s, { type: 'CONTINUE' })).toBe(s);
  });
});

describe('quiz → review → done', () => {
  const quiz = () => run(explaining(4), { type: 'NEXT' }, { type: 'NEXT' }, { type: 'NEXT' }, { type: 'NEXT' });

  it('EVALUATED stores a sorted, de-duplicated review queue', () => {
    const s = next(quiz(), { type: 'EVALUATED', weakChunkIdxs: [3, 1, 3] });
    expect(s).toMatchObject({ status: 'EVALUATED', reviewQueue: [1, 3] });
  });

  it('START_REVIEW explains only the weak chunks, then DONE', () => {
    let s = run(quiz(), { type: 'EVALUATED', weakChunkIdxs: [1, 3] }, { type: 'START_REVIEW' });
    expect(s).toMatchObject({ status: 'EXPLAINING', mode: 'review', position: { chunkIdx: 1, sentenceOffset: 0 } });
    s = next(s, { type: 'CHUNK_DONE' });
    expect(s.position.chunkIdx).toBe(3);
    expect(next(s, { type: 'PREVIOUS' }).position.chunkIdx).toBe(1);
    expect(next(s, { type: 'CHUNK_DONE' }).status).toBe('DONE');
  });

  it('START_REVIEW with nothing to review → DONE', () => {
    expect(run(quiz(), { type: 'EVALUATED', weakChunkIdxs: [] }, { type: 'START_REVIEW' }).status).toBe('DONE');
  });

  it('FINISH skips the review', () => {
    expect(run(quiz(), { type: 'EVALUATED', weakChunkIdxs: [2] }, { type: 'FINISH' }).status).toBe('DONE');
  });

  it('DONE is terminal', () => {
    const done = run(quiz(), { type: 'EVALUATED', weakChunkIdxs: [] }, { type: 'FINISH' });
    expect(next(done, { type: 'START_REVIEW' })).toBe(done);
  });
});
