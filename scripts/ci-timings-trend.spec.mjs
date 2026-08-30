// Fixture-driven coverage for scripts/ci-timings-trend.mjs.
import { describe, expect, it } from 'vitest';

import { buildTrend } from './ci-timings-trend.mjs';

function run(id, { status = 'completed', conclusion = 'success' } = {}) {
  return { id, status, conclusion, event: 'pull_request', head_branch: 'feature' };
}

function jobs(entries) {
  return entries.map(({ name, startedAt, completedAt }) => ({
    name,
    started_at: startedAt,
    completed_at: completedAt,
  }));
}

describe('buildTrend', () => {
  it('computes median/p90/n per job, and wall median/p90, over the runs supplied', () => {
    const runs = [run(1), run(2), run(3)];
    const jobsByRunId = new Map([
      [
        1,
        jobs([
          {
            name: 'Frontend tests',
            startedAt: '2026-01-01T00:00:00Z',
            completedAt: '2026-01-01T00:01:00Z',
          },
        ]),
      ],
      [
        2,
        jobs([
          {
            name: 'Frontend tests',
            startedAt: '2026-01-01T00:00:00Z',
            completedAt: '2026-01-01T00:02:00Z',
          },
        ]),
      ],
      [
        3,
        jobs([
          {
            name: 'Frontend tests',
            startedAt: '2026-01-01T00:00:00Z',
            completedAt: '2026-01-01T00:03:00Z',
          },
        ]),
      ],
    ]);

    const { json, markdown } = buildTrend({ runs, jobsByRunId });

    const frontend = json.jobs.find((j) => j.name === 'Frontend tests');
    expect(frontend.n).toBe(3);
    expect(frontend.medianMs).toBe(120_000); // 2 minutes, the middle value
    expect(frontend.p90Ms).toBe(180_000); // nearest-rank p90 of [60s,120s,180s] is 180s
    expect(json.wall.n).toBe(3);
    expect(markdown).toContain('Frontend tests');
    expect(markdown).toContain('### Wall time');
  });

  it('excludes cancelled runs from the failure-rate denominator, per #436 plan correction 1', () => {
    const runs = [
      run(1, { conclusion: 'success' }),
      run(2, { conclusion: 'failure' }),
      run(3, { conclusion: 'cancelled' }),
    ];
    const jobsByRunId = new Map([
      [
        1,
        jobs([
          { name: 'X', startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:01:00Z' },
        ]),
      ],
      [
        2,
        jobs([
          { name: 'X', startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:01:00Z' },
        ]),
      ],
      [
        3,
        jobs([
          { name: 'X', startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:01:00Z' },
        ]),
      ],
    ]);

    const { json } = buildTrend({ runs, jobsByRunId });

    // 1 failure out of 2 considered runs (run 3 excluded entirely) — not
    // 1/3, and not "the cancelled run counts as neither pass nor fail but
    // stays in the denominator" (which would give 1/3 too, coincidentally
    // the same fraction but not the same set — this asserts the set).
    expect(json.window.consideredRuns).toBe(2);
    expect(json.failureRate).toBeCloseTo(0.5);
  });

  it('does not filter by status=success — a run window that is 100% red still reports a real (100%) failure rate', () => {
    const runs = [run(1, { conclusion: 'failure' }), run(2, { conclusion: 'failure' })];
    const jobsByRunId = new Map();

    const { json, markdown } = buildTrend({ runs, jobsByRunId });

    expect(json.failureRate).toBe(1);
    expect(markdown).toContain('100%');
  });

  it('drops a job that does not appear in the current window, rather than reporting a stale series', () => {
    const runs = [run(1)];
    const jobsByRunId = new Map([
      [
        1,
        jobs([
          {
            name: 'Frontend tests',
            startedAt: '2026-01-01T00:00:00Z',
            completedAt: '2026-01-01T00:01:00Z',
          },
        ]),
      ],
    ]);

    const { json } = buildTrend({ runs, jobsByRunId });

    expect(json.jobs.map((j) => j.name)).toEqual(['Frontend tests']);
    expect(json.jobs.find((j) => j.name === 'Some Retired Job')).toBeUndefined();
  });

  it('skips runs with no completed jobs (path-filtered out entirely) when computing wall', () => {
    const runs = [run(1), run(2)];
    const jobsByRunId = new Map([
      [1, []],
      [
        2,
        jobs([
          { name: 'X', startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:00:10Z' },
        ]),
      ],
    ]);

    const { json } = buildTrend({ runs, jobsByRunId });

    expect(json.wall.n).toBe(1);
  });

  it('reports "—" (not a crash or a 0) when there is no data at all', () => {
    const { json, markdown } = buildTrend({ runs: [], jobsByRunId: new Map() });
    expect(json.failureRate).toBeNull();
    expect(json.wall.medianMs).toBeNull();
    expect(markdown).toContain('_no job data in this window_');
  });

  it('excludes in-progress (non-completed) runs from every computation', () => {
    const runs = [run(1, { status: 'in_progress', conclusion: null }), run(2)];
    const jobsByRunId = new Map([
      [
        2,
        jobs([
          { name: 'X', startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:00:05Z' },
        ]),
      ],
    ]);

    const { json } = buildTrend({ runs, jobsByRunId });

    expect(json.window.consideredRuns).toBe(1);
  });
});
