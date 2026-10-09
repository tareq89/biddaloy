import { PrinterType } from '@biddaloy/shared';

import type { PrintFont } from '../template-renderer';

import { printShell, type PrintCalibration } from './build-print-document';

const CROSS_MM = 20;
const CROSS_ARM_MM = 3;

/**
 * Ruler + crosshair page for measuring a printer's real offset (D21). Uses the
 * printer's current offset and scale, so reprinting after adjusting shows
 * whether the correction worked. `marginMm` draws the no-print band.
 */
export function buildCalibrationDocument(
  printer: PrintCalibration,
  pageMm: { widthMm: number; heightMm: number },
  opts: { marginMm?: number; fonts?: PrintFont[]; lang?: string; title?: string } = {},
): string {
  const { widthMm: w, heightMm: h } =
    printer.type === PrinterType.CARD ? pageMm : { widthMm: 210, heightMm: 297 };
  const line = (x1: number, y1: number, x2: number, y2: number, sw = 0.1) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#000" stroke-width="${sw}"/>`;

  const parts: string[] = [];
  // Rulers: a tick every 1 mm (longer every 10 mm, labelled).
  for (let mm = 0; mm <= w; mm++) {
    const long = mm % 10 === 0;
    parts.push(line(mm, 0, mm, long ? 4 : 2));
    if (long) parts.push(`<text x="${mm + 0.5}" y="7" font-size="2.5">${mm}</text>`);
  }
  for (let mm = 0; mm <= h; mm++) {
    const long = mm % 10 === 0;
    parts.push(line(0, mm, long ? 4 : 2, mm));
    if (long) parts.push(`<text x="5" y="${mm + 1}" font-size="2.5">${mm}</text>`);
  }
  // Crosshairs at (20,20) and (page-20, page-20).
  for (const [cx, cy] of [
    [CROSS_MM, CROSS_MM],
    [w - CROSS_MM, h - CROSS_MM],
  ] as const) {
    parts.push(
      `<g data-crosshair="${cx},${cy}">${line(cx - CROSS_ARM_MM, cy, cx + CROSS_ARM_MM, cy, 0.2)}${line(cx, cy - CROSS_ARM_MM, cx, cy + CROSS_ARM_MM, 0.2)}</g>`,
    );
  }
  const m = opts.marginMm ?? 5;
  parts.push(
    `<rect data-testid="no-print-band" x="${m}" y="${m}" width="${w - 2 * m}" height="${h - 2 * m}" fill="none" stroke="#000" stroke-width="0.2" stroke-dasharray="2 1"/>`,
    `<text x="${CROSS_MM + 6}" y="${CROSS_MM + 10}" font-size="3">Measure how far the crosshair moved and enter it as the offset</text>`,
  );

  const body = `<div class="sheet"><div class="sheet-inner"><svg width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}" font-family="sans-serif">${parts.join('')}</svg></div></div>`;
  return printShell({
    printer,
    pageMm,
    fonts: opts.fonts ?? [],
    lang: opts.lang ?? 'en',
    title: opts.title ?? 'Calibration',
    body,
  });
}
