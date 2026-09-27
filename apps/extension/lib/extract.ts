/**
 * Page extraction, injected with chrome.scripting.executeScript({ func: extractPage }).
 * MUST stay self-contained (no imports, no outer variables): it is serialized into the page.
 * Adapters: Moodle (precise main-region selection) + a generic fallback that works on any page.
 */
export interface RawPage {
  platform: string;
  url: string;
  title: string;
  lang: 'fr' | 'en';
  sections: { heading: string; text: string }[];
  images: { src: string; alt: string; nearbyText: string; sectionIdx: number }[];
}

export function extractPage(): RawPage {
  const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

  // ── platform detection ──
  const html = document.documentElement;
  const generator = document.querySelector('meta[name="generator"]')?.getAttribute('content') ?? '';
  const isMoodle =
    /moodle/i.test(generator) ||
    Boolean(document.querySelector('body[id^="page-mod-"], body[id^="page-course-"], body.path-mod, #page-wrapper #region-main'));
  const isCoursera = /(^|\.)coursera\.org$/.test(location.hostname);
  const isClassroom = location.hostname === 'classroom.google.com';
  const platform = isMoodle ? 'moodle' : isCoursera ? 'coursera' : isClassroom ? 'classroom' : 'generic';

  // ── main content root per adapter ──
  const pick = (...sel: string[]) => sel.map((s) => document.querySelector<HTMLElement>(s)).find((e) => e && clean(e.innerText).length > 80);
  const root =
    (isMoodle && pick('#region-main [role="main"]', '#region-main', '.course-content')) ||
    (isCoursera && pick('[data-testid="reading-body"]', '.rc-CML', 'main')) ||
    (isClassroom && pick('main', '[role="main"]')) ||
    pick('main article', 'article', 'main', '[role="main"]', '#content', '.content') ||
    document.body;

  const SKIP =
    'nav, header, footer, aside, script, style, noscript, form, button, select, textarea, [hidden], [aria-hidden="true"], .sr-only, .visually-hidden, .activity-navigation, .block, #nav-drawer, .breadcrumb, [role="navigation"], [role="banner"], [role="contentinfo"]';
  const TEXT = 'p, li, blockquote, pre, figcaption, dt, dd, td, th';
  const nodes = root.querySelectorAll<HTMLElement>(`h1, h2, h3, h4, ${TEXT}, img`);

  const sections: { heading: string; text: string }[] = [];
  const images: RawPage['images'] = [];
  let current = { heading: '', text: '' };
  const flush = () => {
    if (current.heading || current.text.trim()) sections.push({ heading: current.heading, text: current.text.trim() });
  };

  for (const el of nodes) {
    const excluded = el.closest(SKIP); // menus, headers, hidden text… inside the content root
    if (excluded && excluded !== root && root.contains(excluded)) continue;
    const tag = el.tagName;
    if (/^H[1-4]$/.test(tag)) {
      flush();
      current = { heading: clean(el.innerText), text: '' };
    } else if (tag === 'IMG') {
      const img = el as HTMLImageElement;
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      if (w < 120 || h < 80 || images.length >= 12) continue; // icons, avatars, spacers
      const src = img.currentSrc || img.src;
      if (!src || src.startsWith('data:image/svg')) continue;
      const caption = clean(img.closest('figure')?.querySelector('figcaption')?.textContent);
      const near = caption || clean(img.parentElement?.innerText).slice(0, 400) || current.text.slice(-400);
      images.push({ src, alt: clean(img.alt), nearbyText: near, sectionIdx: sections.length });
    } else {
      if (el.querySelector(TEXT)) continue; // nested (li > p): keep the innermost only
      const text = clean(el.innerText);
      if (text.length < 2) continue;
      current.text += `${tag === 'LI' ? '• ' : ''}${text}\n\n`;
    }
  }
  flush();

  // Robustness: some pages put text in bare <div>s. If the structured pass caught little of the
  // visible text, fall back to the whole visible text of the content root.
  const visible = root.innerText.replace(/\n{3,}/g, '\n\n').trim();
  const caught = sections.reduce((n, s) => n + s.text.length + s.heading.length, 0);
  if (visible.length > 300 && caught < visible.length * 0.3) {
    sections.length = 0;
    sections.push({ heading: '', text: visible });
    for (const img of images) img.sectionIdx = 0;
  }

  const title = clean(root.querySelector('h1')?.textContent) || clean(document.title);
  const lang = (html.lang || navigator.language || 'fr').toLowerCase().startsWith('en') ? 'en' : 'fr';
  return { platform, url: location.href, title, lang, sections: sections.slice(0, 200), images };
}
