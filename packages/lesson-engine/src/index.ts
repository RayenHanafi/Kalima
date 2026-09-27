export type * from './types';
export { initialState, next } from './machine';
export { splitSentences, toBlocks, type Block, type SourcePage } from './text';
export { assembleChunks, type AssembledChunk, type PlannedRange } from './plan';
export { gradeChoice, resolveChoice } from './grading';

export { PlanSchema, planMessages, type Plan } from './prompts/plan';
export { explainMessages, type ExplainInput, type Mistake, type DetailLevel } from './prompts/explain';
export { askMessages, type AskInput } from './prompts/ask';
export { QuizSchema, quizMessages, trueFalseLabels, type QuizDraft } from './prompts/quiz';
export { EvaluationSchema, evaluateMessages, type Evaluation, type EvaluateItem } from './prompts/evaluate';
export { ImageDescriptionSchema, describeImageMessages, type ImageDescription } from './prompts/describe-image';

/**
 * How much the model may think per task (ARCHITECTURE.md §5). Measured on NVIDIA Nemotron Omni:
 * reasoning 'low' delays the first spoken word by ~18 s (vs ~0.3 s with 'off'), so everything the
 * learner waits on live runs with reasoning off; only structure-heavy tasks think a little.
 */
export const TASK_REASONING = {
  explain: 'off',
  ask: 'off',
  describeImage: 'off',
  evaluate: 'off', // choices are graded deterministically; the model only writes explanations
  plan: 'off', // measured: 'low' took ~49 s for 2 pages; the model only returns block ranges, repaired in code
  quiz: 'off', // measured: 'low' took ~35 s; answers are validated/normalized server-side anyway
} as const;
