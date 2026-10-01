export interface FitResult {
  sizePt: number;
  overflowed: boolean;
}

/**
 * Steps the font size down by `stepPt` until `fits(pt)` is true or `minPt`
 * is reached. `fits` applies the size to the DOM and measures, so the last
 * call always leaves the element at the returned `sizePt`.
 */
export function fitFontSize(
  startPt: number,
  minPt: number,
  fits: (pt: number) => boolean,
  stepPt = 0.5,
): FitResult {
  let pt = startPt;
  let ok = fits(pt);
  while (!ok && pt - stepPt >= minPt) {
    pt -= stepPt;
    ok = fits(pt);
  }
  return { sizePt: pt, overflowed: !ok };
}
