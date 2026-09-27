import type { LessonEvent, LessonState } from './types';

export function initialState(): LessonState {
  return {
    status: 'INGESTING',
    mode: 'normal',
    position: { chunkIdx: 0, sentenceOffset: 0 },
    chunkCount: 0,
    reviewQueue: [],
  };
}

const at = (chunkIdx: number) => ({ chunkIdx, sentenceOffset: 0 });

/** Next chunk to explain, or null when the pass (normal or review) is over. */
function following(s: LessonState): number | null {
  if (s.mode === 'review') {
    const i = s.reviewQueue.indexOf(s.position.chunkIdx);
    return s.reviewQueue[i + 1] ?? null;
  }
  const n = s.position.chunkIdx + 1;
  return n < s.chunkCount ? n : null;
}

function preceding(s: LessonState): number {
  if (s.mode === 'review') {
    const i = s.reviewQueue.indexOf(s.position.chunkIdx);
    return s.reviewQueue[Math.max(0, i - 1)] ?? s.position.chunkIdx;
  }
  return Math.max(0, s.position.chunkIdx - 1);
}

/** Jump to any chunk (outline navigation); in review mode only to chunks in the review queue. */
function goTo(s: LessonState, chunkIdx: number): LessonState {
  const valid = s.mode === 'review' ? s.reviewQueue.includes(chunkIdx) : chunkIdx >= 0 && chunkIdx < s.chunkCount;
  return valid ? { ...s, position: at(chunkIdx) } : s;
}

function advance(s: LessonState): LessonState {
  const n = following(s);
  if (n !== null) return { ...s, position: at(n) };
  return s.mode === 'review' ? { ...s, status: 'DONE' } : { ...s, status: 'QUIZ' };
}

/**
 * Pure lesson state machine (ARCHITECTURE.md §3). Events that don't apply to the
 * current status are ignored and return the same state object.
 */
export function next(s: LessonState, e: LessonEvent): LessonState {
  switch (s.status) {
    case 'INGESTING':
      return e.type === 'INGESTED' ? { ...s, status: 'PLANNING' } : s;

    case 'PLANNING':
      if (e.type !== 'PLANNED') return s;
      return e.chunkCount > 0
        ? { ...s, status: 'EXPLAINING', mode: 'normal', chunkCount: e.chunkCount, position: at(0) }
        : s;

    case 'EXPLAINING':
      switch (e.type) {
        case 'SENTENCE_SPOKEN':
          return { ...s, position: { ...s.position, sentenceOffset: Math.max(0, e.sentenceOffset) } };
        case 'CHUNK_DONE':
        case 'NEXT':
          return advance(s);
        case 'PREVIOUS':
          return { ...s, position: at(preceding(s)) };
        case 'REPEAT':
          return { ...s, position: at(s.position.chunkIdx) };
        case 'GOTO':
          return goTo(s, e.chunkIdx);
        case 'STOP':
          return { ...s, status: 'PAUSED', position: { ...s.position, sentenceOffset: Math.max(0, e.sentenceOffset) } };
        case 'ASK':
          return { ...s, status: 'ANSWERING' };
        default:
          return s;
      }

    case 'PAUSED':
      switch (e.type) {
        case 'CONTINUE':
          return { ...s, status: 'EXPLAINING' };
        case 'ASK':
          return { ...s, status: 'ANSWERING' };
        case 'NEXT': {
          const moved = advance(s);
          return moved.status === 'PAUSED' ? { ...moved, status: 'EXPLAINING' } : moved;
        }
        case 'PREVIOUS':
          return { ...s, status: 'EXPLAINING', position: at(preceding(s)) };
        case 'REPEAT':
          return { ...s, status: 'EXPLAINING', position: at(s.position.chunkIdx) };
        case 'GOTO': {
          const moved = goTo(s, e.chunkIdx);
          return moved === s ? s : { ...moved, status: 'EXPLAINING' };
        }
        default:
          return s;
      }

    case 'ANSWERING':
      // After an answer we wait for "continue", so the learner controls the pace.
      return e.type === 'ANSWERED' ? { ...s, status: 'PAUSED' } : s;

    case 'QUIZ':
      return e.type === 'EVALUATED' ? { ...s, status: 'EVALUATED', reviewQueue: [...new Set(e.weakChunkIdxs)].sort((a, b) => a - b) } : s;

    case 'EVALUATED':
      if (e.type === 'FINISH') return { ...s, status: 'DONE' };
      if (e.type !== 'START_REVIEW') return s;
      return s.reviewQueue.length === 0
        ? { ...s, status: 'DONE' }
        : { ...s, status: 'EXPLAINING', mode: 'review', position: at(s.reviewQueue[0]!) };

    case 'DONE':
      return s;
  }
}
