export type ChartColor =
  | 'primary'
  | 'muted'
  | 'cat-1'
  | 'cat-2'
  | 'cat-3'
  | 'seq-1'
  | 'seq-2'
  | 'seq-3';

/** Literal class strings so Tailwind sees them. Never build a class name from a variable. */
export const FILL: Record<ChartColor, string> = {
  primary: 'fill-primary',
  muted: 'fill-muted-foreground/40',
  'cat-1': 'fill-chart-cat-1',
  'cat-2': 'fill-chart-cat-2',
  'cat-3': 'fill-chart-cat-3',
  'seq-1': 'fill-chart-seq-1',
  'seq-2': 'fill-chart-seq-2',
  'seq-3': 'fill-chart-seq-3',
};

export const BG: Record<ChartColor, string> = {
  primary: 'bg-primary',
  muted: 'bg-muted-foreground/40',
  'cat-1': 'bg-chart-cat-1',
  'cat-2': 'bg-chart-cat-2',
  'cat-3': 'bg-chart-cat-3',
  'seq-1': 'bg-chart-seq-1',
  'seq-2': 'bg-chart-seq-2',
  'seq-3': 'bg-chart-seq-3',
};

export const STROKE: Record<ChartColor, string> = {
  primary: 'stroke-primary',
  muted: 'stroke-muted-foreground/40',
  'cat-1': 'stroke-chart-cat-1',
  'cat-2': 'stroke-chart-cat-2',
  'cat-3': 'stroke-chart-cat-3',
  'seq-1': 'stroke-chart-seq-1',
  'seq-2': 'stroke-chart-seq-2',
  'seq-3': 'stroke-chart-seq-3',
};

/** Linear map domain → range. A flat domain maps everything to the range middle. */
export function scaleLinear(
  [d0, d1]: [number, number],
  [r0, r1]: [number, number],
): (v: number) => number {
  if (d0 === d1) return () => (r0 + r1) / 2;
  return (v) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
}

const STEPS = [1, 1.5, 2, 2.5, 5, 10];

/** Smallest "nice" number >= max (1, 1.5, 2, 2.5, 5, 10 × 10^n). 0 → 1. */
export function niceMax(max: number): number {
  if (!(max > 0)) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  const m = max / pow;
  // epsilon guards float noise (e.g. 1.5 exactly)
  const step = STEPS.find((s) => s >= m - 1e-9) ?? 10;
  return step * pow;
}

/** [0, niceMax/count, …, niceMax] */
export function ticks(max: number, count = 3): number[] {
  const top = niceMax(max);
  return Array.from({ length: count + 1 }, (_, i) => (top * i) / count);
}

/** Index of the entry in `xs` closest to `x`. */
export function nearestIndex(x: number, xs: number[]): number {
  let best = 0;
  for (let i = 1; i < xs.length; i++) {
    if (Math.abs(xs[i]! - x) < Math.abs(xs[best]! - x)) best = i;
  }
  return best;
}
