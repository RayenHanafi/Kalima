import type { Block } from './text';
import type { FigureDescription } from './types';

export interface PlannedRange {
  title: string;
  startBlock: number;
  endBlock: number;
}

export interface AssembledChunk {
  idx: number;
  title: string;
  content: string;
  figures: FigureDescription[];
  pageRef: string;
}

/**
 * Turns the planner's block ranges into chunks that cover every block exactly once, in order.
 * Model mistakes (overlaps, gaps, out-of-range, unordered) are repaired deterministically.
 */
export function assembleChunks(
  blocks: Block[],
  ranges: PlannedRange[],
  figures: Map<string, FigureDescription>,
): AssembledChunk[] {
  if (blocks.length === 0) return [];
  const last = blocks.length - 1;
  const clean = ranges
    .map((r) => ({ title: r.title.trim(), start: clamp(r.startBlock, 0, last) }))
    .sort((a, b) => a.start - b.start)
    .filter((r, i, all) => i === 0 || r.start !== all[i - 1]!.start);

  // Blocks before the first range belong to the first chunk; no ranges at all = one chunk.
  if (clean.length === 0) clean.push({ title: '', start: 0 });
  clean[0]!.start = 0;

  return clean.map((r, idx) => {
    const end = idx + 1 < clean.length ? clean[idx + 1]!.start - 1 : last;
    const slice = blocks.slice(r.start, end + 1);
    const text = slice.filter((b) => b.kind === 'text').map((b) => b.text).join('\n\n');
    const figs = slice
      .filter((b) => b.kind === 'figure' && b.figureRef)
      .map((b) => figures.get(b.figureRef!))
      .filter((f): f is FigureDescription => Boolean(f));
    const pages = [...new Set(slice.map((b) => b.pageNo))];
    const pageRef = pages.length > 1 ? `${pages[0]}-${pages[pages.length - 1]}` : String(pages[0]);
    const title = r.title || firstWords(text) || `Part ${idx + 1}`;
    return { idx, title, content: text, figures: figs, pageRef };
  });
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)));

function firstWords(text: string): string {
  return text.split(/\s+/).slice(0, 6).join(' ');
}
