import { CR80, DuplexOrder, PrinterType } from '@biddaloy/shared';
import { describe, expect, it } from 'vitest';

import { layoutPages, orderSides } from './imposition';

const office = { type: PrinterType.OFFICE, marginMm: 5, gapMm: 2 };

describe('orderSides', () => {
  it('INTERLEAVED gives f1,b1,f2,b2', () => {
    expect(orderSides(['1', '2'], DuplexOrder.INTERLEAVED).map((o) => o.side + o.item)).toEqual([
      'front1',
      'back1',
      'front2',
      'back2',
    ]);
  });

  it('GROUPED gives all fronts then all backs', () => {
    expect(orderSides(['1', '2'], DuplexOrder.GROUPED).map((o) => o.side + o.item)).toEqual([
      'front1',
      'front2',
      'back1',
      'back2',
    ]);
  });
});

describe('layoutPages', () => {
  it('fits 10 CR80 cards (2 x 5) on one A4 sheet', () => {
    const sheets = layoutPages(CR80, office, 10, ['front']);
    expect(sheets).toHaveLength(1);
    expect(sheets[0]!.cards).toHaveLength(10);
    expect(new Set(sheets[0]!.cards.map((c) => c.xMm)).size).toBe(2);
    expect(sheets[0]!.cropMarks).toHaveLength(10 * 8);
  });

  it('spills the 11th card onto a second sheet', () => {
    expect(layoutPages(CR80, office, 11, ['front'])).toHaveLength(2);
  });

  it('CARD printer gives one card per sheet at the page size', () => {
    const sheets = layoutPages(CR80, { type: PrinterType.CARD }, 3, ['front']);
    expect(sheets).toHaveLength(3);
    expect(sheets[0]).toMatchObject({ widthMm: CR80.widthMm, heightMm: CR80.heightMm });
    expect(sheets.every((s) => s.cards.length === 1)).toBe(true);
  });

  it('GROUPED office run: fronts then backs, back columns mirrored', () => {
    const sheets = layoutPages(CR80, { ...office, duplex: DuplexOrder.GROUPED }, 11, [
      'front',
      'back',
    ]);
    expect(sheets.map((s) => s.side)).toEqual(['front', 'front', 'back', 'back']);
    const front = sheets[0]!.cards[0]!;
    const back = sheets[2]!.cards[0]!;
    expect(front.index).toBe(back.index);
    expect(front.xMm + back.xMm + CR80.widthMm).toBeCloseTo(210, 5);
    expect(front.yMm).toBe(back.yMm);
  });

  it('INTERLEAVED office run alternates front and back sheets', () => {
    const sheets = layoutPages(CR80, office, 11, ['front', 'back']);
    expect(sheets.map((s) => s.side)).toEqual(['front', 'back', 'front', 'back']);
  });

  it('rejects a card larger than the usable sheet', () => {
    expect(() => layoutPages({ widthMm: 300, heightMm: 50 }, office, 1, ['front'])).toThrow(
      RangeError,
    );
  });
});
