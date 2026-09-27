import { LessonPlayer } from '@kalima/ui';
import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { createCourseFromPage, lessonApi } from '../../lib/api';
import { extractPage } from '../../lib/extract';
import { toDataUrl } from '../../lib/images';
import './style.css';

type Lang = 'fr' | 'en';

const T = {
  fr: {
    intro: 'Ouvrez une page de cours (Moodle, Coursera, Classroom ou tout autre site), puis lancez Kalima.',
    start: 'Lire cette page avec Kalima',
    shortcut: 'Raccourci : Alt + Maj + K',
    reading: 'Lecture de la page…',
    images: (n: number) => `Téléchargement de ${n} image(s)…`,
    preparing: 'Préparation de la leçon (description des images et plan)…',
    empty: 'Je ne trouve pas de contenu de cours sur cette page.',
    failed: 'Impossible de préparer cette page. Réessayez dans un instant.',
    restricted: 'Kalima ne peut pas lire cette page (page du navigateur ou boutique). Ouvrez une page de cours.',
    other: 'Lire une autre page',
  },
  en: {
    intro: 'Open a course page (Moodle, Coursera, Classroom or any other site), then start Kalima.',
    start: 'Read this page with Kalima',
    shortcut: 'Shortcut: Alt + Shift + K',
    reading: 'Reading the page…',
    images: (n: number) => `Downloading ${n} image(s)…`,
    preparing: 'Preparing the lesson (describing images and planning)…',
    empty: "I can't find course content on this page.",
    failed: "Couldn't prepare this page. Please try again in a moment.",
    restricted: "Kalima can't read this page (browser or store page). Open a course page.",
    other: 'Read another page',
  },
};

function App() {
  const uiLang: Lang = navigator.language.toLowerCase().startsWith('en') ? 'en' : 'fr';
  const t = T[uiLang];
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [courseId, setCourseId] = useState<string | null>(null);
  const busyRef = useRef(false);

  async function start() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setCourseId(null);
    try {
      setStatus(t.reading);
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !/^https?:/.test(tab.url ?? '')) throw new Error('restricted');
      const [res] = await browser.scripting.executeScript({ target: { tabId: tab.id }, func: extractPage });
      const raw = res?.result as ReturnType<typeof extractPage> | undefined;
      if (!raw || raw.sections.every((s) => s.text.length < 40)) throw new Error('empty');

      setStatus(t.images(raw.images.length));
      const images = (
        await Promise.all(
          raw.images.map(async (img) => {
            const dataUrl = await toDataUrl(img.src);
            return dataUrl ? { dataUrl, alt: img.alt, nearbyText: img.nearbyText, sectionIdx: img.sectionIdx } : null;
          }),
        )
      ).filter((x): x is NonNullable<typeof x> => x !== null);

      setStatus(t.preparing);
      const { courseId } = await createCourseFromPage({ ...raw, images });
      setStatus('');
      setCourseId(courseId);
    } catch (err) {
      const m = err instanceof Error ? err.message : '';
      setError(m === 'empty' ? t.empty : m === 'restricted' ? t.restricted : t.failed);
      setStatus('');
      console.error(err);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  // Alt+Shift+K: the background sets a flag (panel just opened) or messages us (panel already open).
  useEffect(() => {
    browser.storage.session.get('autostart').then(({ autostart }) => {
      if (typeof autostart === 'number' && Date.now() - autostart < 10_000) {
        browser.storage.session.remove('autostart');
        void start();
      }
    });
    const onMsg = (m: unknown) => {
      if ((m as { type?: string })?.type === 'kalima:start') void start();
    };
    browser.runtime.onMessage.addListener(onMsg);
    return () => browser.runtime.onMessage.removeListener(onMsg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (courseId) {
    return (
      <main>
        <LessonPlayer key={courseId} api={lessonApi} courseId={courseId} onExit={() => setCourseId(null)} />
      </main>
    );
  }

  return (
    <main className="p-5">
      <h1 className="text-3xl font-bold text-primary-strong">Kalima</h1>
      <p className="mt-3 text-lg">{t.intro}</p>
      <button
        type="button"
        autoFocus
        disabled={busy}
        onClick={() => void start()}
        className="mt-6 inline-flex min-h-14 items-center rounded-lg bg-primary px-6 text-xl font-semibold text-primary-foreground hover:bg-primary-hover disabled:opacity-60"
      >
        {t.start}
      </button>
      <p className="mt-3 text-base text-text-muted">{t.shortcut}</p>
      <p role="status" aria-live="polite" className="mt-4 min-h-7 text-lg">
        {status}
      </p>
      {error && (
        <p role="alert" className="mt-2 rounded-lg bg-secondary-tint p-3 text-lg font-semibold text-secondary">
          <span aria-hidden="true">✗ </span>
          {error}
        </p>
      )}
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
