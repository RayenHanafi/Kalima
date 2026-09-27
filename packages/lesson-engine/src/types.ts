export type Lang = 'fr' | 'en';

export type LessonStatus =
  | 'INGESTING'
  | 'PLANNING'
  | 'EXPLAINING'
  | 'PAUSED'
  | 'ANSWERING'
  | 'QUIZ'
  | 'EVALUATED'
  | 'DONE';

export type LessonMode = 'normal' | 'review';

/** Where the learner is: which chunk, and which sentence inside its explanation. */
export interface Position {
  chunkIdx: number;
  sentenceOffset: number;
}

export interface LessonState {
  status: LessonStatus;
  mode: LessonMode;
  position: Position;
  chunkCount: number;
  /** Chunk indexes to re-explain after the quiz (review mode walks through these in order). */
  reviewQueue: number[];
}

export type LessonEvent =
  | { type: 'INGESTED' }
  | { type: 'PLANNED'; chunkCount: number }
  | { type: 'SENTENCE_SPOKEN'; sentenceOffset: number }
  | { type: 'CHUNK_DONE' }
  | { type: 'NEXT' }
  | { type: 'PREVIOUS' }
  | { type: 'REPEAT' }
  | { type: 'GOTO'; chunkIdx: number }
  | { type: 'STOP'; sentenceOffset: number }
  | { type: 'CONTINUE' }
  | { type: 'ASK' }
  | { type: 'ANSWERED' }
  | { type: 'EVALUATED'; weakChunkIdxs: number[] }
  | { type: 'START_REVIEW' }
  | { type: 'FINISH' };

export interface Course {
  id: string;
  title: string | null;
  lang: Lang;
  sourceType: 'pdf' | 'web';
}

export interface FigureDescription {
  ref: string;
  short: string;
  detailed: string;
}

export interface Chunk {
  id: string;
  idx: number;
  title: string;
  content: string;
  figures: FigureDescription[];
  pageRef: string | null;
}

export interface LessonSession {
  id: string;
  courseId: string;
  status: LessonStatus;
  mode: LessonMode;
  currentChunkIdx: number;
  sentenceOffset: number;
}

export type QuestionType = 'mcq' | 'true_false' | 'short';

export interface QuizQuestion {
  id: string;
  type: QuestionType;
  question: string;
  /** mcq: 3–4 options; true_false: [true label, false label]; short: empty. */
  options: string[];
  answer: string;
  chunkIdx: number;
  chunkId: string;
}

/** What the learner sees: never includes the answer. */
export type PublicQuizQuestion = Omit<QuizQuestion, 'answer'>;

export interface QuestionResult {
  id: string;
  correct: boolean;
  learnerAnswer: string;
  correctAnswer: string;
  explanation: string;
  chunkIdx: number;
}

export interface QuizResult {
  score: number;
  results: QuestionResult[];
  weakChunkIdxs: number[];
}

/** Output of the extension's page adapters (phase 4). */
export interface PagePayload {
  platform: string;
  url: string;
  title: string;
  lang?: Lang;
  sections: { heading: string; text: string }[];
  /** dataUrl: downscaled JPEG fetched by the extension; sectionIdx: section the image sits in. */
  images: { dataUrl: string; alt: string; nearbyText: string; sectionIdx: number }[];
}

/** Minimal chat message shape (structurally compatible with @kalima/llm's Message). */
export type PromptMessage =
  | { role: 'system' | 'assistant'; content: string }
  | {
      role: 'user';
      content:
        | string
        | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
    };
