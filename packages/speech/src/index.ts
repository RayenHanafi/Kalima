// Web Speech API wrappers (browser only). One global voice: any new speak() or cancel() stops the old one.

export type SpeechLang = 'fr' | 'en';

const BCP47: Record<SpeechLang, string> = { fr: 'fr-FR', en: 'en-US' };

function pickVoice(lang: SpeechLang): SpeechSynthesisVoice | undefined {
  if (typeof speechSynthesis === 'undefined') return undefined;
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith(lang));
  // Prefer natural / online voices when the browser has them.
  return voices.find((v) => /natural|neural|google|online/i.test(v.name)) ?? voices[0];
}

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export interface Speaker {
  /** Speaks sentences in order; resolves when all are spoken (or cancelled → false). */
  speak(sentences: string[], opts?: { onSentence?: (i: number) => void }): Promise<boolean>;
  cancel(): void;
  setRate(rate: number): void;
  setLang(lang: SpeechLang): void;
}

export function createSpeaker(initialLang: SpeechLang, initialRate = 1): Speaker {
  let lang = initialLang;
  let rate = initialRate;
  let generation = 0;

  /** One utterance; resolves on end/error, or after a length-based timeout (headless / buggy engines). */
  function sayOne(text: string, gen: number): Promise<void> {
    return new Promise((resolve) => {
      if (!speechSupported() || gen !== generation) return resolve();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = BCP47[lang];
      const voice = pickVoice(lang);
      if (voice) u.voice = voice;
      u.rate = rate;
      const words = text.split(/\s+/).length;
      const timer = setTimeout(resolve, (words / (2.6 * rate)) * 1000 + 2500);
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      u.onend = done;
      u.onerror = done;
      speechSynthesis.speak(u);
    });
  }

  return {
    async speak(sentences, opts) {
      const gen = ++generation;
      if (speechSupported()) speechSynthesis.cancel();
      for (let i = 0; i < sentences.length; i++) {
        if (gen !== generation) return false;
        opts?.onSentence?.(i);
        await sayOne(sentences[i]!, gen);
      }
      return gen === generation;
    },
    cancel() {
      generation++;
      if (speechSupported()) speechSynthesis.cancel();
    },
    setRate(r) {
      rate = r;
    },
    setLang(l) {
      lang = l;
    },
  };
}

// ── Listening ──────────────────────────────────────────────────────────────

interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  abort(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

function Recognition(): (new () => RecognitionLike) | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition) as (new () => RecognitionLike) | undefined;
}

export function listenSupported(): boolean {
  return Boolean(Recognition());
}

/** Push-to-talk: listens for one utterance. Resolves with the transcript, or null (silence / error / unsupported). */
export function listenOnce(lang: SpeechLang, signal?: AbortSignal): Promise<string | null> {
  const R = Recognition();
  if (!R) return Promise.resolve(null);
  return new Promise((resolve) => {
    const rec = new R();
    rec.lang = BCP47[lang];
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    let text: string | null = null;
    rec.onresult = (e) => {
      text = e.results[0]?.[0]?.transcript?.trim() || null;
    };
    rec.onerror = () => {};
    rec.onend = () => resolve(text);
    signal?.addEventListener('abort', () => rec.abort(), { once: true });
    try {
      rec.start();
    } catch {
      resolve(null);
    }
  });
}

// ── Voice commands ─────────────────────────────────────────────────────────

export type VoiceCommand =
  | { type: 'stop' }
  | { type: 'continue' }
  | { type: 'repeat' }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'question'; text: string }
  | { type: 'answer'; text: string };

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Maps a transcript to a command. Anything else is treated as free text (a question or an answer). */
export function parseCommand(transcript: string): VoiceCommand {
  const t = norm(transcript);
  if (/^(stop|pause|arrete|arreter|attends)$/.test(t)) return { type: 'stop' };
  if (/^(continue|continuer|continuez|reprends|reprendre|resume|go on|play)$/.test(t)) return { type: 'continue' };
  if (/^(repeat|repete|repeter|encore|again)$/.test(t)) return { type: 'repeat' };
  if (/^(next|suivant|suivante|partie suivante)$/.test(t)) return { type: 'next' };
  if (/^(previous|precedent|precedente|back|retour)$/.test(t)) return { type: 'previous' };
  const q = t.match(/^(question|j ai une question|i have a question)\s*(.*)$/);
  if (q) return { type: 'question', text: transcript.replace(/^\s*(question|j'ai une question|i have a question)[\s,:]*/i, '').trim() };
  return { type: 'answer', text: transcript.trim() };
}
