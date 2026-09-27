const OPEN = '<think>';
const CLOSE = '</think>';

/** Removes <think>…</think> blocks (and an orphan leading block ending in </think>). */
export function stripThinking(text: string): string {
  let out = text.replace(/<think>[\s\S]*?<\/think>/g, '');
  const orphan = out.indexOf(CLOSE);
  if (orphan !== -1) out = out.slice(orphan + CLOSE.length);
  return out.trim();
}

/** Length of the longest suffix of `s` that is a prefix of `tag` (a tag possibly split across chunks). */
function partialTagSuffix(s: string, tag: string): number {
  for (let n = Math.min(tag.length - 1, s.length); n > 0; n--) {
    if (tag.startsWith(s.slice(-n))) return n;
  }
  return 0;
}

/** Streaming version of stripThinking: feed deltas, get only the visible text back. */
export class ThinkFilter {
  private buf = '';
  private inside = false;

  push(chunk: string): string {
    this.buf += chunk;
    let out = '';
    for (;;) {
      if (this.inside) {
        const end = this.buf.indexOf(CLOSE);
        if (end === -1) {
          this.buf = this.buf.slice(-(CLOSE.length - 1));
          return out;
        }
        this.buf = this.buf.slice(end + CLOSE.length);
        this.inside = false;
        continue;
      }
      const start = this.buf.indexOf(OPEN);
      if (start === -1) {
        const hold = partialTagSuffix(this.buf, OPEN);
        out += this.buf.slice(0, this.buf.length - hold);
        this.buf = this.buf.slice(this.buf.length - hold);
        return out;
      }
      out += this.buf.slice(0, start);
      this.buf = this.buf.slice(start + OPEN.length);
      this.inside = true;
    }
  }

  flush(): string {
    const rest = this.inside ? '' : this.buf;
    this.buf = '';
    return rest;
  }
}

/** Garbage output seen live from the NVIDIA free endpoint (runs of <unk>) or nothing at all. */
export function isDegenerate(text: string): boolean {
  return text.trim() === '' || text.includes('<unk>');
}

/** Parses the first JSON object/array in a model reply, tolerating code fences and prose around it. */
export function extractJson(text: string): unknown {
  const unfenced = text.replace(/```(?:json)?/gi, '');
  const start = unfenced.search(/[[{]/);
  if (start === -1) throw new Error('no JSON found');
  const close = unfenced[start] === '{' ? '}' : ']';
  const end = unfenced.lastIndexOf(close);
  if (end < start) throw new Error('unterminated JSON');
  return JSON.parse(unfenced.slice(start, end + 1));
}
