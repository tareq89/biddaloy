import { describe, expect, it } from 'vitest';
import { formatMarkdownTable, formatTable, passes, percentile, summarise } from './load-stats';

const row = (over: Partial<Parameters<typeof formatTable>[0][number]> = {}) => ({
  phase: 'cold',
  role: 'ADMIN',
  endpoint: '/dashboard/widgets/x',
  n: 30,
  p50: 10,
  p95: 20,
  max: 30,
  errors: 0,
  ...over,
});

describe('percentile', () => {
  it('uses nearest-rank', () => {
    expect(percentile([10, 20, 30, 40, 50], 95)).toBe(50);
    const hundred = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(hundred, 95)).toBe(95);
    expect(percentile(hundred, 50)).toBe(50);
  });
  it('is NaN for no samples', () => {
    expect(percentile([], 95)).toBeNaN();
  });
});

describe('summarise', () => {
  it('counts errors and finds max', () => {
    const s = summarise([
      { ms: 30, ok: true },
      { ms: 10, ok: true },
      { ms: 500, ok: false },
    ]);
    expect(s).toMatchObject({ n: 3, max: 500, errors: 1, p50: 30 });
  });
});

describe('formatTable', () => {
  it('marks p95 >= 300 as FAIL and 299 as PASS', () => {
    const text = formatTable([row({ p95: 299 }), row({ p95: 300, endpoint: '/b' })]);
    const [, pass, fail] = text.split('\n');
    expect(pass).toMatch(/PASS$/);
    expect(fail).toMatch(/FAIL$/);
  });
  it('fails an error row even with a low p95', () => {
    expect(formatTable([row({ p95: 5, errors: 1 })])).toMatch(/FAIL$/);
  });
  it('shows — for no samples, and that row is a FAIL', () => {
    const empty = row({ n: 0, p50: NaN, p95: NaN, max: NaN });
    expect(formatTable([empty])).toContain('—');
    expect(passes(empty)).toBe(false);
  });
  it('renders a markdown table with a header rule', () => {
    const md = formatMarkdownTable([row()]);
    expect(md.split('\n')[1]).toBe('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    expect(md).toContain('| PASS |');
  });
});
