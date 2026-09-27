/**
 * Splits spoken text into sentences. The client speaks and tracks position by these,
 * so the server and client must use the same function.
 */
export function splitSentences(text: string): string[] {
  return (
    text
      .replace(/\s+/g, ' ')
      .trim()
      // Break after . ! ? … (optionally followed by quotes/brackets) when a new sentence starts.
      .split(/(?<=[.!?…]["»”')\]]?)\s+(?=[A-ZÀ-ÖØ-Þ0-9«"“(])/u)
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

export interface Block {
  /** Stable id shown to the planner, e.g. "b7". */
  id: string;
  n: number;
  pageNo: number;
  kind: 'text' | 'figure';
  text: string;
  figureRef?: string;
}

export interface SourcePage {
  pageNo: number;
  text: string;
  figures: { ref: string; short: string; detailed: string }[];
}

const MIN_BLOCK_CHARS = 200;

/**
 * Cuts the raw course into numbered paragraph blocks. The planner only returns block ranges,
 * so chunk content is always the course's own words (no rewriting, no invention, small output).
 */
export function toBlocks(pages: SourcePage[]): Block[] {
  const blocks: Block[] = [];
  const push = (b: Omit<Block, 'id' | 'n'>) => {
    const n = blocks.length;
    blocks.push({ ...b, id: `b${n}`, n });
  };
  for (const page of [...pages].sort((a, b) => a.pageNo - b.pageNo)) {
    const paragraphs = page.text
      .split(/\n\s*\n/)
      .map((p) => p.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    let pending = '';
    for (const p of paragraphs) {
      pending = pending ? `${pending}\n${p}` : p;
      if (pending.length >= MIN_BLOCK_CHARS) {
        push({ pageNo: page.pageNo, kind: 'text', text: pending });
        pending = '';
      }
    }
    if (pending) push({ pageNo: page.pageNo, kind: 'text', text: pending });
    for (const f of page.figures) {
      push({ pageNo: page.pageNo, kind: 'figure', text: f.detailed, figureRef: f.ref });
    }
  }
  return blocks;
}
