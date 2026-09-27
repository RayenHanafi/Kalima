import type { LessonMode, LessonStatus, PublicQuizQuestion, QuestionResult } from '@kalima/lesson-engine';

/** What the player needs from the backend. The web app and the extension each provide one. */
export interface LessonApi {
  startSession(courseId: string): Promise<{
    session: { id: string; status: LessonStatus; mode: LessonMode; currentChunkIdx: number; sentenceOffset: number };
    course: { id: string; title: string | null; lang: string };
    chunks: { id: string; idx: number; title: string }[];
    resumed: boolean;
  }>;
  saveSession(
    sessionId: string,
    patch: Partial<{ status: LessonStatus; mode: LessonMode; currentChunkIdx: number; sentenceOffset: number }>,
  ): Promise<void>;
  /** Streams text deltas of a chunk explanation. */
  explain(sessionId: string, chunkIdx: number, mode: LessonMode, signal?: AbortSignal): AsyncGenerator<string>;
  /** Streams text deltas of an answer. */
  ask(sessionId: string, question: string, chunkIdx: number, signal?: AbortSignal): AsyncGenerator<string>;
  quiz(sessionId: string): Promise<{ quizId: string; questions: PublicQuizQuestion[] }>;
  submit(
    quizId: string,
    answers: Record<string, string>,
  ): Promise<{ score: number; results: QuestionResult[]; weakChunkIdxs: number[] }>;
}
