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

/**
 * Why listening produced no text:
 * - denied: microphone permission refused (site or Windows privacy settings)
 * - no-mic: no microphone found
 * - service: the browser's recognition service is unreachable (offline, or a Chromium browser
 *   without Google's speech service, e.g. Brave)
 * - no-speech: nothing was said
 * - unsupported: no Web Speech recognition (Firefox, Safari on some versions)
 */
export type ListenError = 'denied' | 'no-mic' | 'service' | 'no-speech' | 'unsupported' | 'other';
export interface ListenResult {
  text: string | null;
  error?: ListenError;
}

const ERRORS: Record<string, ListenError> = {
  'not-allowed': 'denied',
  'service-not-allowed': 'denied',
  'audio-capture': 'no-mic',
  network: 'service',
  'language-not-supported': 'service',
  'no-speech': 'no-speech',
  aborted: 'no-speech',
};

/** Push-to-talk: listens for one utterance. `onStart` fires when the microphone is actually open. */
export function listenOnce(lang: SpeechLang, opts: { signal?: AbortSignal; onStart?: () => void } = {}): Promise<ListenResult> {
  const R = Recognition();
  if (!R) return Promise.resolve({ text: null, error: 'unsupported' });
  return new Promise((resolve) => {
    const rec = new R() as RecognitionLike & { onaudiostart?: (() => void) | null };
    rec.lang = BCP47[lang];
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    let text: string | null = null;
    let error: ListenError | undefined;
    rec.onaudiostart = () => opts.onStart?.();
    rec.onresult = (e) => {
      text = e.results[0]?.[0]?.transcript?.trim() || null;
    };
    rec.onerror = (e) => {
      error = ERRORS[e.error] ?? 'other';
      console.warn('[speech] recognition error:', e.error);
    };
    rec.onend = () => resolve(text ? { text } : { text: null, error: error ?? 'no-speech' });
    opts.signal?.addEventListener('abort', () => rec.abort(), { once: true });
    try {
      rec.start();
    } catch (err) {
      console.warn('[speech] could not start recognition:', err);
      resolve({ text: null, error: 'other' });
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
