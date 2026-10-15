// [8.10.7.6.02] Pure helpers for the dashboard load run. No I/O.

/** D21: a widget endpoint passes when its p95 is under this many milliseconds. */
export const P95_LIMIT_MS = 300;

export interface Sample {
  ms: number;
  ok: boolean;
}
export interface Summary {
  n: number;
  p50: number;
  p95: number;
  max: number;
  errors: number;
}
export interface Row extends Summary {
  phase: string;
  role: string;
  endpoint: string;
}

/** Nearest-rank percentile of an ASCENDING list. Empty list gives NaN. */
export function percentile(sortedMs: number[], p: number): number {
  if (sortedMs.length === 0) return NaN;
  const rank = Math.ceil((p / 100) * sortedMs.length);
  return sortedMs[Math.min(sortedMs.length, Math.max(1, rank)) - 1];
}

export function summarise(samples: Sample[]): Summary {
  const sorted = samples.map((s) => s.ms).sort((a, b) => a - b);
  return {
    n: samples.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted.length ? sorted[sorted.length - 1] : NaN,
    errors: samples.filter((s) => !s.ok).length,
  };
}

/** PASS needs samples, no errors, and p95 under the limit. No samples is a FAIL, not a silent pass. */
export function passes(s: Summary, limitMs: number = P95_LIMIT_MS): boolean {
  return s.n > 0 && s.errors === 0 && s.p95 < limitMs;
}

const ms = (v: number): string => (Number.isNaN(v) ? '—' : `${Math.round(v)}ms`);

function cells(r: Row, limitMs: number): string[] {
  return [
    r.phase,
    r.role,
    r.endpoint,
    String(r.n),
    ms(r.p50),
    ms(r.p95),
    ms(r.max),
    String(r.errors),
    passes(r, limitMs) ? 'PASS' : 'FAIL',
  ];
}
const HEAD = ['phase', 'role', 'endpoint', 'n', 'p50', 'p95', 'max', 'err', 'result'];

/** Aligned plain-text table (numbers right-aligned). */
export function formatTable(rows: Row[], limitMs: number = P95_LIMIT_MS): string {
  const lines = [HEAD, ...rows.map((r) => cells(r, limitMs))];
  const widths = HEAD.map((_, i) => Math.max(...lines.map((l) => l[i].length)));
  return lines
    .map((l) =>
      l
        .map((c, i) => (i >= 3 && i <= 7 ? c.padStart(widths[i]) : c.padEnd(widths[i])))
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
}

/** The same rows as a GitHub markdown table. */
export function formatMarkdownTable(rows: Row[], limitMs: number = P95_LIMIT_MS): string {
  const line = (c: string[]) => `| ${c.join(' | ')} |`;
  return [
    line(HEAD),
    line(HEAD.map(() => '---')),
    ...rows.map((r) => line(cells(r, limitMs))),
  ].join('\n');
}
