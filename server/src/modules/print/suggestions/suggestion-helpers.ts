import type { PrintElement } from '@biddaloy/shared';

export type Rect = [x: number, y: number, w: number, h: number];

export const NAVY = '#0B3A6B';
export const WHITE = '#FFFFFF';
export const SANS = 'Biddaloy Sans';
export const SERIF_BN = 'Noto Serif Bengali';
/** Replaced with a real, tenant-owned asset id when a school instantiates the suggestion. */
export const PLACEHOLDER_ASSET = '00000000-0000-4000-8000-000000000000';

/** Split a rect into `n` equal rows (or columns when `cols`). */
export function split([x, y, w, h]: Rect, n: number, cols = false): Rect[] {
  return Array.from({ length: n }, (_, i) =>
    cols ? [x + (w / n) * i, y, w / n, h] : [x, y + (h / n) * i, w, h / n],
  );
}

export interface TextOpts {
  field?: string;
  text?: string;
  font?: string;
  pt: number;
  color: string;
  weight?: 400 | 500 | 600 | 700;
  align: 'left' | 'center' | 'right';
}

export function text([x, y, w, h]: Rect, o: TextOpts): PrintElement {
  return {
    id: '',
    type: 'TEXT',
    x,
    y,
    w,
    h,
    ...(o.field !== undefined ? { field: o.field } : { text: o.text ?? '' }),
    fontFamily: o.font ?? SANS,
    sizePt: o.pt,
    minSizePt: Math.max(4, o.pt - 3),
    weight: o.weight ?? 400,
    color: o.color,
    align: o.align,
    overflow: 'SHRINK',
  };
}

export const ids = (side: string, els: PrintElement[]): PrintElement[] =>
  els.map((e, i) => ({ ...e, id: `${side}-${i + 1}` }));
