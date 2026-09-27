'use client';

import type { Lang, PublicQuizQuestion } from '@kalima/lesson-engine';
import { listenOnce, listenSupported, type Speaker } from '@kalima/speech';
import { useEffect, useRef, useState } from 'react';
import { strings } from './strings';
import { btn, btnPrimary } from './styles';

const LETTERS = ['A', 'B', 'C', 'D', 'E'];

export interface QuizViewProps {
  questions: PublicQuizQuestion[];
  lang: Lang;
  speaker: Speaker;
  onSubmit: (answers: Record<string, string>) => void | Promise<void>;
}

/** One question at a time, read aloud; answer by keys (1–4 / A–D), clicks, typing or voice (V). */
export function QuizView({ questions, lang, speaker, onSubmit }: QuizViewProps) {
  const t = strings[lang];
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const textRef = useRef<HTMLInputElement>(null);
  const q = questions[idx]!;
  const last = idx === questions.length - 1;

  const read = () =>
    speaker.speak([
      t.question(idx + 1, questions.length),
      q.question,
      ...q.options.map((o, i) => t.option(LETTERS[i]!, o)),
    ]);

  useEffect(() => {
    setValue(answers[q.id] ?? '');
    void read();
    if (q.type === 'short') setTimeout(() => textRef.current?.focus(), 0);
    else document.getElementById(`opt-${q.id}-0`)?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  async function validate(answer = value) {
    const all = { ...answers, [q.id]: answer };
    setAnswers(all);
    if (!last) {
      setIdx(idx + 1);
      return;
    }
    setBusy(true);
    await onSubmit(all);
    setBusy(false);
  }

  async function voice() {
    speaker.cancel();
    const heard = await listenOnce(lang);
    if (!heard) return void speaker.speak([t.notHeard]);
    setValue(heard);
    await speaker.speak([t.youAnswered(heard)]);
    void validate(heard);
  }

  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (ev) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey || busy) return;
    const typing = (ev.target as HTMLElement | null)?.closest('input[type="text"], textarea');
    const k = ev.key.toLowerCase();
    if (k === 'v' && !typing) return void voice();
    if (k === 'r' && !typing) return void read();
    // Inside the form, Enter submits natively (onSubmit); only handle it when focus is elsewhere.
    if (k === 'enter' && value && !(ev.target as HTMLElement | null)?.closest('form, button')) {
      ev.preventDefault();
      return void validate();
    }
    if (typing || q.type === 'short') return;
    const i = /^[1-5]$/.test(k) ? Number(k) - 1 : LETTERS.indexOf(k.toUpperCase());
    if (i >= 0 && q.options[i]) {
      setValue(q.options[i]!);
      document.getElementById(`opt-${q.id}-${i}`)?.focus();
      speaker.speak([t.option(LETTERS[i]!, q.options[i]!)]);
    }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  return (
    <form
      className="mt-6 rounded-2xl bg-surface p-6"
      onSubmit={(ev) => {
        ev.preventDefault();
        if (value) void validate();
      }}
    >
      <fieldset>
        <legend className="text-lg text-text-muted">{t.question(idx + 1, questions.length)}</legend>
        <p className="mt-2 text-2xl font-bold leading-snug">{q.question}</p>
        {q.type === 'short' ? (
          <label className="mt-4 flex flex-col gap-2 text-lg font-semibold">
            {t.yourAnswer}
            <input
              ref={textRef}
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="min-h-12 rounded-lg border-2 border-border bg-background px-3 text-lg font-normal"
              autoComplete="off"
            />
          </label>
        ) : (
          <div className="mt-4 space-y-3">
            {q.options.map((o, i) => (
              <label
                key={o}
                className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border-2 border-border bg-background px-4 text-xl has-checked:border-primary has-checked:font-bold"
              >
                <input
                  id={`opt-${q.id}-${i}`}
                  type="radio"
                  name={q.id}
                  value={o}
                  checked={value === o}
                  onChange={() => setValue(o)}
                  className="size-5 accent-primary"
                />
                <span>
                  <span aria-hidden="true">{LETTERS[i]}. </span>
                  {o}
                </span>
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <p className="mt-4 text-base text-text-muted">{t.quizHint}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="submit" disabled={!value || busy} className={btnPrimary}>
          {last ? t.submitQuiz : t.validate} <kbd className="text-sm opacity-80">({t.keyEnter})</kbd>
        </button>
        <button type="button" onClick={() => void read()} className={btn}>
          {t.repeat} <kbd className="text-sm opacity-70">(R)</kbd>
        </button>
        {listenSupported() && (
          <button type="button" onClick={() => void voice()} className={btn}>
            {t.voice} <kbd className="text-sm opacity-70">(V)</kbd>
          </button>
        )}
      </div>
    </form>
  );
}
