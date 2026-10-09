/**
 * [32.3.2] How sharp an image will print: its pixels spread over the millimetres it
 * covers. 300 dpi is the usual print standard; under 150 dpi looks visibly soft.
 */
const MM_PER_INCH = 25.4;

/** Effective resolution of an image `widthPx` wide when printed `elementWidthMm` wide. */
export function effectiveDpi(widthPx: number, elementWidthMm: number): number {
  if (!(elementWidthMm > 0) || !(widthPx > 0)) return 0;
  return widthPx / (elementWidthMm / MM_PER_INCH);
}

export type DpiLevel = 'good' | 'ok' | 'low';

export const DPI_GOOD = 300;
export const DPI_LOW = 150;

/**
 * Classified on the nearest whole dpi. Pixel counts are whole numbers, so a genuine
 * 300 dpi design can't measure exactly 300: 1011 px across an 85.6 mm card is 299.993.
 * Without rounding, that standard design would be flagged as "may look soft".
 */
export function dpiLevel(dpi: number): DpiLevel {
  const rounded = Math.round(dpi);
  if (rounded >= DPI_GOOD) return 'good';
  if (rounded >= DPI_LOW) return 'ok';
  return 'low';
}
