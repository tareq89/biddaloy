import { describe, expect, it } from 'vitest';

import { fitFontSize } from './fit-text';

describe('fitFontSize', () => {
  it('keeps the start size when it already fits', () => {
    expect(fitFontSize(12, 6, () => true)).toEqual({ sizePt: 12, overflowed: false });
  });

  it('steps down 0.5pt until it fits', () => {
    expect(fitFontSize(12, 6, (pt) => pt <= 10)).toEqual({ sizePt: 10, overflowed: false });
  });

  it('stops at minSizePt and reports overflow when nothing fits', () => {
    const seen: number[] = [];
    const r = fitFontSize(8, 6, (pt) => {
      seen.push(pt);
      return false;
    });
    expect(r).toEqual({ sizePt: 6, overflowed: true });
    expect(seen).toEqual([8, 7.5, 7, 6.5, 6]);
  });
});
