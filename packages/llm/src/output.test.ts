import { describe, expect, it } from 'vitest';
import { extractJson, isDegenerate, stripThinking, ThinkFilter } from './output';

describe('stripThinking', () => {
  it('removes think blocks and orphan closing tags', () => {
    expect(stripThinking('<think>a</think> B <think>c</think>')).toBe('B');
    expect(stripThinking('reasoning…</think>\nAnswer')).toBe('Answer');
    expect(stripThinking('\nPlain')).toBe('Plain');
  });
});

describe('ThinkFilter', () => {
  it('handles tags split across chunks', () => {
    const f = new ThinkFilter();
    const out = ['Hi <th', 'ink>secret', ' stuff</th', 'ink> there', '<'].map((c) => f.push(c)).join('') + f.flush();
    expect(out).toBe('Hi  there<');
  });
});

describe('isDegenerate', () => {
  it('flags empty and <unk> output', () => {
    expect(isDegenerate('  ')).toBe(true);
    expect(isDegenerate('<unk><unk>')).toBe(true);
    expect(isDegenerate('fine')).toBe(false);
  });
});

describe('extractJson', () => {
  it('finds JSON inside prose', () => {
    expect(extractJson('Sure! {"a": [1, 2]} hope that helps')).toEqual({ a: [1, 2] });
    expect(extractJson('[1,2]')).toEqual([1, 2]);
  });
});
