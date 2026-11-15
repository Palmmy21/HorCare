import { describe, expect, it } from 'vitest';
import { pageBands } from './pageBands';

const lines = (n: number, h: number, from = 0) => Array.from({ length: n }, (_, i) => ({ top: from + i * h, bottom: from + i * h + h - 4 }));

describe('pageBands', () => {
  it('keeps a short document on one page', () => {
    expect(pageBands(lines(5, 40), 400, 1123, 60)).toEqual([{ start: 0, end: 400 }]);
  });

  it('cuts only between blocks', () => {
    const blocks = lines(40, 50, 60);
    const bands = pageBands(blocks, 60 + 40 * 50 + 60, 1123, 60);
    expect(bands.length).toBeGreaterThan(1);
    for (const band of bands.slice(0, -1)) {
      expect(blocks.some(b => b.top < band.end - 0.5 && b.bottom > band.end + 0.5)).toBe(false);
      expect(band.end - band.start).toBeLessThanOrEqual(1123 - 60);
    }
    expect(bands[bands.length - 1].end).toBeLessThanOrEqual(60 + 40 * 50 + 60);
  });

  it('never cuts inside an outer block that holds smaller ones', () => {
    const blocks = [{ top: 60, bottom: 900 }, { top: 900, bottom: 1300 }, { top: 900, bottom: 1000 }, { top: 1300, bottom: 1500 }];
    const bands = pageBands(blocks, 1560, 1123, 60);
    expect(bands[0].end).toBe(900);
  });

  it('splits a block taller than a page rather than looping', () => {
    const bands = pageBands([{ top: 0, bottom: 3000 }], 3000, 1123, 60);
    expect(bands.length).toBe(3);
    expect(bands[bands.length - 1].end).toBe(3000);
  });

  it('moves a heading at the foot of a page over with the text it heads', () => {
    // body lines fill page 1 up to 1000; a heading 1004–1036 fits, its first line 1040–1080 does not
    const blocks = [...lines(20, 50, 0), { top: 1004, bottom: 1036, keepWithNext: true }, { top: 1040, bottom: 1080 }, { top: 1084, bottom: 1124 }];
    const bands = pageBands(blocks, 1200, 1123, 60);
    expect(bands[0].end).toBe(996);
  });

  it('adds no blank page for the bottom padding', () => {
    expect(pageBands(lines(21, 50, 60), 60 + 21 * 50 + 1500, 1123, 60)).toHaveLength(2);
  });
});
