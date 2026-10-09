import { DuplexOrder, PrinterType } from '@biddaloy/shared';

export type Side = 'front' | 'back';

export interface SheetCard {
  /** Index of the card within the whole run. */
  index: number;
  xMm: number;
  yMm: number;
}

export interface CropMark {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Sheet {
  side: Side;
  widthMm: number;
  heightMm: number;
  cards: SheetCard[];
  cropMarks: CropMark[];
}

export interface PrinterSetup {
  type: PrinterType;
  /** OFFICE only. Default 5. */
  marginMm?: number;
  /** OFFICE only, between cards. Default 2. */
  gapMm?: number;
  /** Sheet order when printing both sides. Default INTERLEAVED. */
  duplex?: DuplexOrder;
}

const A4 = { widthMm: 210, heightMm: 297 } as const;
const CROP_MM = 3;

/** INTERLEAVED: f1,b1,f2,b2. GROUPED: all fronts, then all backs. */
export function orderSides<T>(items: readonly T[], duplex: DuplexOrder): { item: T; side: Side }[] {
  const fronts = items.map((item) => ({ item, side: 'front' as const }));
  const backs = items.map((item) => ({ item, side: 'back' as const }));
  return duplex === DuplexOrder.GROUPED
    ? [...fronts, ...backs]
    : fronts.flatMap((f, i) => [f, backs[i]!]);
}

function orderSheets(
  count: number,
  sides: readonly Side[],
  duplex: DuplexOrder | undefined,
): { item: number; side: Side }[] {
  const nums = Array.from({ length: count }, (_, i) => i);
  return sides.length === 2
    ? orderSides(nums, duplex ?? DuplexOrder.INTERLEAVED)
    : nums.map((item) => ({ item, side: 'front' as const }));
}

export function layoutPages(
  pageMm: { widthMm: number; heightMm: number },
  printer: PrinterSetup,
  count: number,
  sides: readonly Side[],
): Sheet[] {
  const { widthMm: w, heightMm: h } = pageMm;

  if (printer.type === PrinterType.CARD) {
    return orderSheets(count, sides, printer.duplex).map(({ item, side }) => ({
      side,
      widthMm: w,
      heightMm: h,
      cards: [{ index: item, xMm: 0, yMm: 0 }],
      cropMarks: [],
    }));
  }

  const margin = printer.marginMm ?? 5;
  const gap = printer.gapMm ?? 2;
  const cols = Math.floor((A4.widthMm - 2 * margin + gap) / (w + gap));
  const rows = Math.floor((A4.heightMm - 2 * margin + gap) / (h + gap));
  if (cols < 1 || rows < 1) throw new RangeError('card does not fit on an A4 sheet');
  const perSheet = cols * rows;
  const x0 = (A4.widthMm - (cols * w + (cols - 1) * gap)) / 2;
  const y0 = (A4.heightMm - (rows * h + (rows - 1) * gap)) / 2;

  const build = (n: number, side: Side): Sheet => {
    const cards: SheetCard[] = [];
    for (let k = 0; k < perSheet && n * perSheet + k < count; k++) {
      const col = k % cols;
      // Mirroring the columns makes each back land behind its front when the stack is flipped.
      const c = side === 'back' ? cols - 1 - col : col;
      cards.push({
        index: n * perSheet + k,
        xMm: x0 + c * (w + gap),
        yMm: y0 + Math.floor(k / cols) * (h + gap),
      });
    }
    // 3 mm ticks pointing outward from each card corner.
    const cropMarks = cards.flatMap(({ xMm: x, yMm: y }) =>
      [x, x + w].flatMap((cx) =>
        [y, y + h].flatMap((cy) => {
          const dx = cx === x ? -CROP_MM : CROP_MM;
          const dy = cy === y ? -CROP_MM : CROP_MM;
          return [
            { x1: cx, y1: cy, x2: cx + dx, y2: cy },
            { x1: cx, y1: cy, x2: cx, y2: cy + dy },
          ];
        }),
      ),
    );
    return { side, widthMm: A4.widthMm, heightMm: A4.heightMm, cards, cropMarks };
  };

  return orderSheets(Math.ceil(count / perSheet), sides, printer.duplex).map(({ item, side }) =>
    build(item, side),
  );
}
