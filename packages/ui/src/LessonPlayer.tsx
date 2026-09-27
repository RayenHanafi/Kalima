'use client';

import {
  next,
  splitSentences,
  type Lang,
  type LessonEvent,
  type LessonMode,
  type LessonState,
  type PublicQuizQuestion,
  type QuestionResult,
} from '@kalima/lesson-engine';
import { createSpeaker, listenOnce, listenSupported, parseCommand, type Speaker } from '@kalima/speech';
import { useEffect, useRef, useState } from 'react';
import type { LessonApi } from './api';
import { QuizView } from './QuizView';
import { strings } from './strings';
import { btn, btnPrimary, btnSecondary } from './styles';

type Phase = 'loading' | 'ready' | 'lesson' | 'quiz' | 'results' | 'done' | 'error';

/** Text arriving from a stream; subscribers are woken on every change. */
interface Entry {
  text: string;
  done: boolean;
  error: string | null;
  subs: Set<() => void>;
}

function streamEntry(gen: AsyncGenerator<string>, onFail?: () => void): Entry {
  const e: Entry = { text: '', done: false, error: null, subs: new Set() };
  const notify = () => {
    const subs = [...e.subs];
    e.subs.clear();
    subs.forEach((f) => f());
  };
  (async () => {
    try {
      for await (const d of gen) {
        e.text += d;
        notify();
      }
    } catch (err) {
      e.error = err instanceof Error ? err.message : String(err);
      onFail?.();
    }
    e.done = true;
    notify();
  })();
  return e;
}

const waitFor = (e: Entry) => new Promise<void>((r) => e.subs.add(r));

export interface LessonPlayerProps {
  api: LessonApi;
  courseId: string;
  onExit?: () => void;
}

export function LessonPlayer({ api, courseId, onExit }: LessonPlayerProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [lang, setLang] = useState<Lang>('fr');
  const [title, setTitle] = useState('');
  const [chunks, setChunks] = useState<{ id: string; idx: number; title: string }[]>([]);
  const [lesson, setLesson] = useState<LessonState | null>(null);
  const [resumed, setResumed] = useState(false);
  const [sentences, setSentences] = useState<string[]>([]);
  const [current, setCurrent] = useState(-1);
  const [status, setStatus] = useState('');
  const [asking, setAsking] = useState(false);
  const [qa, setQa] = useState<{ question: string; answer: string } | null>(null);
  const [quiz, setQuiz] = useState<{ quizId: string; questions: PublicQuizQuestion[] } | null>(null);
  const [results, setResults] = useState<{ score: number; results: QuestionResult[]; weakChunkIdxs: number[] } | null>(null);

  const stateRef = useRef<LessonState | null>(null);
  const sessionRef = useRef('');
  const runRef = useRef(0);
  const entries = useRef(new Map<string, Entry>());
  const speakerRef = useRef<Speaker | null>(null);
  const questionInput = useRef<HTMLInputElement>(null);
  const t = strings[lang];

  const speaker = () => (speakerRef.current ??= createSpeaker(lang));
  const say = (...lines: string[]) => speaker().speak(lines.flatMap(splitSentences));

  // ── load session ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    api
      .startSession(courseId)
      .then(({ session, course, chunks, resumed }) => {
        if (cancelled) return;
        const l: Lang = course.lang === 'en' ? 'en' : 'fr';
        setLang(l);
        speaker().setLang(l);
        setTitle(course.title ?? '');
        setChunks(chunks);
        setResumed(resumed);
        sessionRef.current = session.id;
        const s: LessonState = {
          status: 'PAUSED',
          mode: 'normal',
          position: { chunkIdx: Math.min(session.currentChunkIdx, chunks.length - 1), sentenceOffset: session.sentenceOffset },
          chunkCount: chunks.length,
          reviewQueue: [],
        };
        if (session.status === 'QUIZ' || session.status === 'EVALUATED') s.status = 'QUIZ';
        stateRef.current = s;
        setLesson(s);
        setPhase('ready');
      })
      .catch(() => !cancelled && setPhase('error'));
    return () => {
      cancelled = true;
      runRef.current++;
      speakerRef.current?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, courseId]);

  // ── state machine + persistence ──────────────────────────────────────────
  function apply(e: LessonEvent): LessonState {
    const prev = stateRef.current!;
    const s = next(prev, e);
    if (s === prev) return s;
    stateRef.current = s;
    setLesson(s);
    const changed = s.status !== prev.status || s.position.chunkIdx !== prev.position.chunkIdx || s.mode !== prev.mode;
    if (changed || e.type === 'STOP') {
      api
        .saveSession(sessionRef.current, {
          status: s.status === 'ANSWERING' ? 'PAUSED' : s.status === 'INGESTING' || s.status === 'PLANNING' ? 'EXPLAINING' : s.status,
          mode: s.mode,
          currentChunkIdx: s.position.chunkIdx,
          sentenceOffset: s.position.sentenceOffset,
        })
        .catch(() => {});
    }
    return s;
  }

  function load(idx: number, mode: LessonMode): Entry {
    const key = `${mode}:${idx}`;
    const existing = entries.current.get(key);
    if (existing) return existing;
    const e = streamEntry(api.explain(sessionRef.current, idx, mode), () => entries.current.delete(key));
    entries.current.set(key, e);
    return e;
  }

  function followingChunk(idx: number, mode: LessonMode): number | undefined {
    const s = stateRef.current!;
    if (mode === 'review') return s.reviewQueue[s.reviewQueue.indexOf(idx) + 1];
    return idx + 1 < s.chunkCount ? idx + 1 : undefined;
  }

  /** Speaks an entry sentence by sentence as it streams in. Returns false if interrupted. */
  async function speakEntry(e: Entry, from: number, run: number, onSpoken?: (next: number) => void, onDone?: () => void) {
    let i = from;
    let doneSeen = false;
    for (;;) {
      if (run !== runRef.current) return false;
      const ss = splitSentences(e.text);
      const ready = e.done ? ss.length : Math.max(0, ss.length - 1);
      setSentences(ss);
      if (e.done && !doneSeen) {
        doneSeen = true;
        onDone?.();
      }
      if (i < ready) {
        setCurrent(i);
        setStatus('');
        const ok = await speaker().speak([ss[i]!]);
        if (!ok || run !== runRef.current) return false;
        i++;
        onSpoken?.(i);
        continue;
      }
      if (e.done) return true;
      await waitFor(e);
    }
  }

  async function runChunk(idx: number, mode: LessonMode, from: number) {
    const run = ++runRef.current;
    setPhase('lesson');
    setQa(null);
    setSentences([]);
    setCurrent(-1);
    const chunk = chunks.find((c) => c.idx === idx);
    const e = load(idx, mode); // start streaming while the part title is spoken
    if (from === 0 && chunk) {
      const label = mode === 'review' ? t.reviewPart(chunk.title) : t.part(idx + 1, chunks.length, chunk.title);
      if (!(await speaker().speak([label])) || run !== runRef.current) return;
    }
    if (!e.text) setStatus(t.loading);
    const finished = await speakEntry(
      e,
      from,
      run,
      (n) => apply({ type: 'SENTENCE_SPOKEN', sentenceOffset: n }),
      () => {
        const n = followingChunk(idx, mode);
        if (n !== undefined) load(n, mode); // prefetch: no gap between parts
      },
    );
    if (!finished) return;
    if (e.error && !e.text) {
      apply({ type: 'STOP', sentenceOffset: 0 });
      setStatus(t.aiDown);
      await say(t.aiDown);
      return;
    }
    const s = apply({ type: 'CHUNK_DONE' });
    continueFrom(s);
  }

  function continueFrom(s: LessonState) {
    if (s.status === 'EXPLAINING') void runChunk(s.position.chunkIdx, s.mode, s.position.sentenceOffset);
    else if (s.status === 'QUIZ') void startQuiz();
    else if (s.status === 'DONE') void finish();
  }

  // ── controls ─────────────────────────────────────────────────────────────
  function stopSpeaking() {
    runRef.current++;
    speaker().cancel();
  }

  function pause() {
    const s = stateRef.current;
    if (s?.status !== 'EXPLAINING') return;
    stopSpeaking();
    apply({ type: 'STOP', sentenceOffset: s.position.sentenceOffset });
    setStatus(t.paused);
  }

  function resume() {
    const s0 = stateRef.current;
    if (s0?.status === 'ANSWERING') {
      stopSpeaking();
      apply({ type: 'ANSWERED' });
    }
    const s = apply({ type: 'CONTINUE' });
    if (s.status === 'EXPLAINING') continueFrom(s);
  }

  function toggle() {
    const st = stateRef.current?.status;
    if (st === 'EXPLAINING') pause();
    else if (st === 'PAUSED' || st === 'ANSWERING') resume();
  }

  function move(e: LessonEvent) {
    const st = stateRef.current?.status;
    if (st !== 'EXPLAINING' && st !== 'PAUSED') return;
    stopSpeaking();
    continueFrom(apply(e));
  }

  async function openAsk(viaVoice: boolean) {
    const st = stateRef.current?.status;
    if (st !== 'EXPLAINING' && st !== 'PAUSED') return;
    stopSpeaking();
    apply({ type: 'ASK' });
    setQa(null);
    setAsking(true);
    if (viaVoice && listenSupported()) {
      setStatus(t.listening);
      const run = runRef.current;
      const heard = await listenOnce(lang);
      if (run !== runRef.current) return; // the learner typed a question (or moved on) meanwhile
      if (heard) return sendQuestion(heard);
      setStatus(t.notHeard);
      void say(t.notHeard);
    }
    setTimeout(() => questionInput.current?.focus(), 0);
  }

  async function sendQuestion(question: string) {
    const q = question.trim();
    if (!q) return;
    if (stateRef.current?.status !== 'ANSWERING') apply({ type: 'ASK' });
    setAsking(false);
    setQa({ question: q, answer: '' });
    setStatus(t.answering);
    const run = ++runRef.current;
    const e = streamEntry(api.ask(sessionRef.current, q, stateRef.current!.position.chunkIdx));
    const unsub = setInterval(() => setQa({ question: q, answer: e.text }), 250);
    const ok = await speakEntryAnswer(e, run);
    clearInterval(unsub);
    setQa({ question: q, answer: e.text || t.aiDown });
    if (!ok) return;
    if (e.error && !e.text) await say(t.aiDown);
    apply({ type: 'ANSWERED' });
    setStatus(t.afterAnswer);
    void say(t.afterAnswer);
  }

  /** Answers are spoken like explanations, but don't move the lesson position. */
  async function speakEntryAnswer(e: Entry, run: number) {
    let i = 0;
    for (;;) {
      if (run !== runRef.current) return false;
      const ss = splitSentences(e.text);
      const ready = e.done ? ss.length : Math.max(0, ss.length - 1);
      if (i < ready) {
        setStatus('');
        if (!(await speaker().speak([ss[i]!])) || run !== runRef.current) return false;
        i++;
        continue;
      }
      if (e.done) return true;
      await waitFor(e);
    }
  }

  async function voiceCommand() {
    if (!listenSupported()) {
      setStatus(t.notHeard);
      return;
    }
    if (stateRef.current?.status === 'EXPLAINING') pause();
    else stopSpeaking();
    setStatus(t.listening);
    const run = runRef.current;
    const heard = await listenOnce(lang);
    if (run !== runRef.current) return;
    if (!heard) {
      setStatus(t.notHeard);
      return;
    }
    const c = parseCommand(heard);
    switch (c.type) {
      case 'stop':
        setStatus(t.paused);
        return;
      case 'continue':
        return resume();
      case 'repeat':
        return move({ type: 'REPEAT' });
      case 'next':
        return move({ type: 'NEXT' });
      case 'previous':
        return move({ type: 'PREVIOUS' });
      case 'question':
        return c.text ? sendQuestion(c.text) : openAsk(true);
      case 'answer':
        return sendQuestion(c.text);
    }
  }

  // ── quiz → results → review ──────────────────────────────────────────────
  async function startQuiz() {
    stopSpeaking();
    setPhase('quiz');
    setQuiz(null);
    setStatus(t.quizLoading);
    const intro = say(t.quizIntro);
    try {
      const q = await api.quiz(sessionRef.current);
      await intro;
      setStatus('');
      setQuiz(q);
    } catch {
      setStatus(t.aiDown);
      void say(t.aiDown);
    }
  }

  async function submitQuiz(answers: Record<string, string>) {
    if (!quiz) return;
    stopSpeaking();
    setStatus(t.grading);
    void say(t.grading);
    try {
      const res = await api.submit(quiz.quizId, answers);
      apply({ type: 'EVALUATED', weakChunkIdxs: res.weakChunkIdxs });
      setResults(res);
      setPhase('results');
      setStatus('');
      const ok = res.results.filter((r) => r.correct).length;
      const lines = [t.score(ok, res.results.length)];
      res.results.forEach((r, i) => {
        lines.push(`${t.question(i + 1, res.results.length)}. ${r.correct ? t.correct : t.incorrect}.`);
        if (!r.correct) lines.push(t.rightAnswer(r.correctAnswer));
        if (r.explanation) lines.push(r.explanation);
      });
      lines.push(res.weakChunkIdxs.length ? t.resultsHint : t.finish);
      void say(...lines);
    } catch {
      setStatus(t.aiDown);
      void say(t.aiDown);
    }
  }

  function startReview() {
    stopSpeaking();
    continueFrom(apply({ type: 'START_REVIEW' }));
  }

  async function finish() {
    stopSpeaking();
    if (stateRef.current?.status === 'EVALUATED') apply({ type: 'FINISH' });
    setPhase('done');
    setStatus(t.done);
    void say(t.done);
  }

  function start() {
    const s = stateRef.current!;
    if (s.status === 'QUIZ') return void startQuiz();
    continueFrom(apply({ type: 'CONTINUE' }));
  }

  // ── keyboard ─────────────────────────────────────────────────────────────
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (ev: KeyboardEvent) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const target = ev.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
    const k = ev.key.toLowerCase();
    if (phase === 'results') {
      if (k === 'r' && results?.weakChunkIdxs.length) startReview();
      else if (k === 'enter' && !target?.closest('button, a')) void finish();
      return;
    }
    if (phase !== 'lesson') return;
    if (k === ' ') {
      if (target?.closest('button, a')) return; // the focused control handles Space itself
      ev.preventDefault();
      toggle();
    } else if (k === 'q') {
      ev.preventDefault();
      void openAsk(true);
    } else if (k === 'r') move({ type: 'REPEAT' });
    else if (k === 'n') move({ type: 'NEXT' });
    else if (k === 'p') move({ type: 'PREVIOUS' });
    else if (k === 'v') void voiceCommand();
    else if (k === '?') void say(t.startHint);
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // ── render ───────────────────────────────────────────────────────────────
  const s = lesson;
  const playing = s?.status === 'EXPLAINING';
  const chunk = s ? chunks.find((c) => c.idx === s.position.chunkIdx) : undefined;
  const partLabel =
    chunk && s ? (s.mode === 'review' ? t.reviewPart(chunk.title) : t.part(chunk.idx + 1, chunks.length, chunk.title)) : '';

  return (
    <section aria-labelledby="lesson-title" className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <h1 id="lesson-title" className="text-3xl font-bold text-primary-strong sm:text-4xl">
        {title || '…'}
      </h1>
      <p role="status" aria-live="polite" className="mt-3 min-h-8 text-lg text-text-muted">
        {phase === 'error' ? t.aiDown : status}
      </p>

      {phase === 'ready' && (
        <div className="mt-6 rounded-2xl bg-surface p-6">
          <p className="text-lg">{t.startHint}</p>
          <button type="button" autoFocus onClick={start} className={`${btnPrimary} mt-6 min-h-14 px-8 text-xl`}>
            {resumed ? t.resume : t.start}
          </button>
        </div>
      )}

      {phase === 'lesson' && s && (
        <>
          <h2 className="mt-6 text-2xl font-bold">{partLabel}</h2>
          <div className="mt-4 rounded-2xl bg-surface p-6 text-2xl leading-relaxed">
            {sentences.length === 0 ? (
              <p className="text-text-muted">{t.loading}</p>
            ) : (
              <p>
                {sentences.map((sentence, i) => (
                  <span
                    key={i}
                    className={
                      i === current
                        ? 'rounded bg-primary/15 underline decoration-primary decoration-4 underline-offset-8'
                        : undefined
                    }
                  >
                    {sentence}{' '}
                  </span>
                ))}
              </p>
            )}
          </div>

          <div role="toolbar" aria-label="Lecture" className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={toggle}
              aria-keyshortcuts="Space"
              className={`${playing ? btnSecondary : btnPrimary} min-w-40`}
            >
              {playing ? t.pause : t.play} <kbd className="text-sm opacity-80">({t.keySpace})</kbd>
            </button>
            <button type="button" onClick={() => void openAsk(false)} aria-keyshortcuts="Q" className={btn}>
              {t.ask} <kbd className="text-sm opacity-70">(Q)</kbd>
            </button>
            <button type="button" onClick={() => move({ type: 'REPEAT' })} aria-keyshortcuts="R" className={btn}>
              {t.repeat} <kbd className="text-sm opacity-70">(R)</kbd>
            </button>
            <button type="button" onClick={() => move({ type: 'PREVIOUS' })} aria-keyshortcuts="P" className={btn}>
              {t.previous} <kbd className="text-sm opacity-70">(P)</kbd>
            </button>
            <button type="button" onClick={() => move({ type: 'NEXT' })} aria-keyshortcuts="N" className={btn}>
              {t.next} <kbd className="text-sm opacity-70">(N)</kbd>
            </button>
            {listenSupported() && (
              <button type="button" onClick={() => void voiceCommand()} aria-keyshortcuts="V" className={btn}>
                {t.voice} <kbd className="text-sm opacity-70">(V)</kbd>
              </button>
            )}
          </div>

          {asking && (
            <form
              className="mt-6 flex flex-wrap items-end gap-3 rounded-2xl border-2 border-primary p-4"
              onSubmit={(ev) => {
                ev.preventDefault();
                void sendQuestion(questionInput.current?.value ?? '');
              }}
            >
              <label className="flex min-w-64 flex-1 flex-col gap-2 text-lg font-semibold">
                {t.questionLabel}
                <input
                  ref={questionInput}
                  className="min-h-12 rounded-lg border-2 border-border px-3 text-lg font-normal"
                  autoComplete="off"
                />
              </label>
              <button type="submit" className={btnPrimary}>
                {t.send}
              </button>
            </form>
          )}

          {qa && (
            <div className="mt-6 rounded-2xl border-2 border-primary-strong p-5 text-xl leading-relaxed">
              <p className="font-bold">« {qa.question} »</p>
              <p className="mt-3">{qa.answer || t.answering}</p>
            </div>
          )}

          <nav aria-label={t.outline} className="mt-8">
            <h2 className="text-xl font-bold">{t.outline}</h2>
            <ol className="mt-3 space-y-2">
              {chunks.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => move({ type: 'GOTO', chunkIdx: c.idx })}
                    aria-current={c.idx === s.position.chunkIdx ? 'step' : undefined}
                    className="min-h-11 w-full rounded-lg px-3 text-left text-lg hover:bg-surface aria-[current=step]:bg-surface aria-[current=step]:font-bold"
                  >
                    {c.idx + 1}. {c.title}
                  </button>
                </li>
              ))}
            </ol>
          </nav>
        </>
      )}

      {phase === 'quiz' && quiz && (
        <QuizView questions={quiz.questions} lang={lang} speaker={speaker()} onSubmit={submitQuiz} />
      )}

      {phase === 'results' && results && (
        <div className="mt-6">
          <h2 className="text-2xl font-bold">
            {t.score(results.results.filter((r) => r.correct).length, results.results.length)}
          </h2>
          <ol className="mt-4 space-y-4">
            {results.results.map((r, i) => (
              <li
                key={r.id}
                className={`rounded-2xl border-2 p-5 text-lg ${r.correct ? 'border-primary bg-surface' : 'border-secondary bg-secondary-tint'}`}
              >
                <p className={`font-bold ${r.correct ? 'text-primary-strong' : 'text-secondary'}`}>
                  <span aria-hidden="true">{r.correct ? '✓ ' : '✗ '}</span>
                  {t.question(i + 1, results.results.length)} — {r.correct ? t.correct : t.incorrect}
                </p>
                <p className="mt-2">{t.youAnswered(r.learnerAnswer)}</p>
                {!r.correct && <p className="mt-1 font-semibold">{t.rightAnswer(r.correctAnswer)}</p>}
                {r.explanation && <p className="mt-2">{r.explanation}</p>}
              </li>
            ))}
          </ol>
          <div className="mt-6 flex flex-wrap gap-3">
            {results.weakChunkIdxs.length > 0 && (
              <button type="button" autoFocus onClick={startReview} className={btnPrimary}>
                {t.review} <kbd className="text-sm opacity-80">(R)</kbd>
              </button>
            )}
            <button type="button" onClick={() => void finish()} className={btn}>
              {t.finish}
            </button>
          </div>
        </div>
      )}

      {phase === 'done' && (
        <div className="mt-6 rounded-2xl bg-surface p-6">
          <p className="text-2xl font-bold text-primary-strong">{t.done}</p>
          {results && (
            <p className="mt-2 text-lg">{t.score(results.results.filter((r) => r.correct).length, results.results.length)}</p>
          )}
          {onExit && (
            <button type="button" autoFocus onClick={onExit} className={`${btn} mt-6`}>
              {t.back}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
