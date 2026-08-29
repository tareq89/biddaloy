// Fixture-driven coverage for scripts/ci-timings.mjs — normalization from
// real reporter shapes, path derivation, and the budget-gate's exit-code
// behaviour. The budget-gate tests (#436, AC 3 / #356's lesson) are
// load-bearing: a gate that always warns and never fails is the same class
// of bug as a gate that never runs at all.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  buildPlaywrightRecord,
  buildReportText,
  buildRecord,
  buildSummary,
  buildVitestRecord,
  deriveVitestProject,
  emptyRecord,
  resolveRecord,
} from './ci-timings.mjs';

const tempDirs = [];
function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'ci-timings-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop(), { recursive: true, force: true });
});

describe('deriveVitestProject', () => {
  it('maps ui .test.tsx to ui:jsdom', () => {
    expect(deriveVitestProject('ui/src/a.test.tsx')).toBe('ui:jsdom');
  });

  it('maps ui .spec.ts to ui:node', () => {
    expect(deriveVitestProject('ui/src/a.spec.ts')).toBe('ui:node');
  });

  it('always maps shared to shared:node, even for .test files', () => {
    expect(deriveVitestProject('shared/src/a.spec.ts')).toBe('shared:node');
    expect(deriveVitestProject('shared/src/a.test.ts')).toBe('shared:node');
  });

  it('maps anything under server/ to the bare "server" project', () => {
    expect(deriveVitestProject('server/src/a.integration.spec.ts')).toBe('server');
    expect(deriveVitestProject('server/src/a.spec.ts')).toBe('server');
  });

  it('maps client-admin the same way as ui', () => {
    expect(deriveVitestProject('client-admin/src/a.test.tsx')).toBe('client-admin:jsdom');
  });

  it('returns null for anything outside the known top-level packages', () => {
    expect(deriveVitestProject('scripts/ci-timings.spec.mjs')).toBeNull();
    expect(deriveVitestProject('e2e/journeys/auth.spec.ts')).toBeNull();
  });
});

describe('buildVitestRecord', () => {
  // Shape verified against a real `vitest run --reporter=json` output
  // (`--project shared:node`) during planning — see #436's plan comment.
  const raw = {
    numTotalTests: 2,
    startTime: 1000,
    success: true,
    testResults: [
      {
        name: '/repo/ui/src/a.test.tsx',
        startTime: 1000,
        endTime: 1100,
        status: 'passed',
        assertionResults: [
          { status: 'passed', duration: 50, fullName: 'a > works' },
          { status: 'failed', duration: 10, fullName: 'a > breaks' },
        ],
      },
      {
        name: '/repo/shared/src/a.spec.ts',
        startTime: 1050,
        endTime: 1400,
        status: 'passed',
        assertionResults: [{ status: 'pending', duration: 0, fullName: 'b > todo' }],
      },
    ],
  };

  it('normalizes wall (max endTime - report startTime), work (sum of per-file durations), and per-file rows', () => {
    const record = buildVitestRecord({
      raw,
      suite: 'frontend',
      job: 'Frontend tests',
      repoRoot: '/repo',
    });

    expect(record.wallMs).toBe(400); // max(1100, 1400) - 1000
    expect(record.workMs).toBe(450); // (1100-1000) + (1400-1050)
    expect(record.totals).toEqual({ files: 2, tests: 2, failed: 1, skipped: 1, flaky: 0 });
    expect(record.files).toEqual([
      {
        file: 'ui/src/a.test.tsx',
        project: 'ui:jsdom',
        durationMs: 100,
        tests: 2,
        status: 'passed',
      },
      {
        file: 'shared/src/a.spec.ts',
        project: 'shared:node',
        durationMs: 350,
        tests: 1,
        status: 'passed',
      },
    ]);
  });

  it('normalizes absolute paths under server/ to the repo-relative form with no project suffix', () => {
    const serverRaw = {
      numTotalTests: 1,
      startTime: 0,
      testResults: [
        {
          name: '/repo/server/src/students/students.integration.spec.ts',
          startTime: 0,
          endTime: 20,
          status: 'passed',
          assertionResults: [{ status: 'passed', duration: 20, fullName: 'x' }],
        },
      ],
    };
    const record = buildVitestRecord({
      raw: serverRaw,
      suite: 'integration',
      job: 'Integration & e2e tests',
      repoRoot: '/repo',
    });
    expect(record.files[0].file).toBe('server/src/students/students.integration.spec.ts');
    expect(record.files[0].project).toBe('server');
  });
});

describe('buildPlaywrightRecord', () => {
  // Shape from `JSONReportSuite`/`JSONReportSpec`
  // (node_modules/playwright/types/testReporter.d.ts), verified against a
  // real `playwright test --list` run during planning.
  const raw = {
    config: { rootDir: '/repo/e2e' },
    stats: {
      startTime: '2026-08-29T12:00:00.000Z',
      duration: 5000,
      expected: 2,
      unexpected: 0,
      skipped: 0,
      flaky: 1,
    },
    suites: [
      {
        title: 'journeys/auth.spec.ts',
        file: 'journeys/auth.spec.ts',
        specs: [
          {
            title: 'logs in',
            file: 'journeys/auth.spec.ts',
            tests: [
              {
                status: 'expected',
                projectName: 'chromium',
                results: [{ duration: 400 }],
              },
            ],
          },
        ],
        suites: [
          {
            title: 'nested describe',
            file: 'journeys/auth.spec.ts',
            specs: [
              {
                title: 'retries once then passes',
                file: 'journeys/auth.spec.ts',
                tests: [
                  {
                    status: 'flaky',
                    projectName: 'chromium',
                    // Both retries counted — a file that only goes green on
                    // retry 2 genuinely cost that time.
                    results: [{ duration: 300 }, { duration: 250 }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  it('flattens nested suites, sums all retries per file, and resolves file paths against config.rootDir', () => {
    const record = buildPlaywrightRecord({
      raw,
      suite: 'e2e-chromium',
      job: 'E2E (chromium 1/3)',
      repoRoot: '/repo',
    });

    expect(record.startedAt).toBe('2026-08-29T12:00:00.000Z');
    expect(record.wallMs).toBe(5000);
    expect(record.totals).toEqual({ files: 1, tests: 3, failed: 0, skipped: 0, flaky: 1 });
    expect(record.files).toEqual([
      {
        file: 'e2e/journeys/auth.spec.ts',
        project: 'chromium',
        durationMs: 950,
        tests: 2,
        status: 'passed',
      },
    ]);
  });

  it('marks a file failed when any of its tests are unexpected', () => {
    const failing = {
      config: { rootDir: '/repo/e2e' },
      stats: {
        startTime: '2026-01-01T00:00:00.000Z',
        duration: 100,
        expected: 0,
        unexpected: 1,
        skipped: 0,
        flaky: 0,
      },
      suites: [
        {
          title: 'x.spec.ts',
          file: 'x.spec.ts',
          specs: [
            {
              title: 'y',
              file: 'x.spec.ts',
              tests: [{ status: 'unexpected', results: [{ duration: 50 }] }],
            },
          ],
        },
      ],
    };
    const record = buildPlaywrightRecord({
      raw: failing,
      suite: 'e2e-chromium',
      job: 'E2E (chromium 1/3)',
      repoRoot: '/repo',
    });
    expect(record.files[0].status).toBe('failed');
  });
});

describe('buildRecord (missing/corrupt input, #436 AC — never crashes)', () => {
  it('returns a zeroed record with an error field for unparseable JSON, instead of throwing', () => {
    const record = buildRecord({
      runner: 'vitest',
      suite: 'unit',
      job: 'Build, lint, unit tests',
      rawText: '{ not json',
      repoRoot: '/repo',
    });
    expect(record.wallMs).toBe(0);
    expect(record.workMs).toBe(0);
    expect(record.totals).toEqual({ files: 0, tests: 0, failed: 0, skipped: 0, flaky: 0 });
    expect(record.error).toMatch(/could not parse/);
  });

  it('resolveRecord returns a zeroed record (not a thrown error) when --in does not exist', () => {
    const dir = makeTempDir();
    const record = resolveRecord({
      runner: 'vitest',
      suite: 'unit',
      job: 'Build, lint, unit tests',
      inPath: join(dir, 'does-not-exist.json'),
      repoRoot: dir,
    });
    expect(record.wallMs).toBe(0);
    expect(record.error).toMatch(/does not exist/);
  });

  it('resolveRecord builds a real record when the file exists', () => {
    const dir = makeTempDir();
    const inPath = join(dir, 'raw.json');
    writeFileSync(
      inPath,
      JSON.stringify({
        numTotalTests: 1,
        startTime: 0,
        testResults: [
          {
            name: join(dir, 'ui/src/a.test.tsx'),
            startTime: 0,
            endTime: 10,
            status: 'passed',
            assertionResults: [{ status: 'passed', duration: 10, fullName: 'x' }],
          },
        ],
      }),
    );
    const record = resolveRecord({
      runner: 'vitest',
      suite: 'frontend',
      job: 'Frontend tests',
      inPath,
      repoRoot: dir,
    });
    expect(record.error).toBeUndefined();
    expect(record.wallMs).toBe(10);
    expect(record.files[0].file).toBe('ui/src/a.test.tsx');
  });
});

describe('buildSummary — wall/work/gap', () => {
  // Mirrors the plan's worked example (#436, run 33231461954, full green PR
  // run): wall 574s, work 1577s, longest job "E2E (chromium)" 558s, gap 16s.
  const jobs = [
    {
      name: 'Detect changed areas',
      started_at: '2026-08-29T00:00:00.000Z',
      completed_at: '2026-08-29T00:00:09.000Z',
    },
    {
      name: 'Build, lint, unit tests',
      started_at: '2026-08-29T00:00:09.000Z',
      completed_at: '2026-08-29T00:03:12.000Z',
    },
    {
      name: 'Frontend tests',
      started_at: '2026-08-29T00:00:09.000Z',
      completed_at: '2026-08-29T00:06:11.000Z',
    },
    {
      name: 'E2E (chromium)',
      started_at: '2026-08-29T00:00:09.000Z',
      completed_at: '2026-08-29T00:09:29.000Z',
    },
    // Longest job (558s) ends 16s before the run itself does — the "gap".
    {
      name: 'Storybook build',
      started_at: '2026-08-29T00:00:09.000Z',
      completed_at: '2026-08-29T00:09:45.000Z',
    },
  ];

  it('computes wall as last completed_at - first started_at, work as the sum of job durations, and gap as wall - longest job', () => {
    const { markdown } = buildSummary({ records: [], jobs, budgets: { jobs: {} } });
    // wall = 585s (00:09:45), longest job = "E2E (chromium)" at 560s... this
    // fixture's own arithmetic is asserted directly below rather than by
    // eyeballing the markdown.
    const totalMs =
      new Date(jobs[jobs.length - 1].completed_at).getTime() -
      new Date(jobs[0].started_at).getTime();
    expect(markdown).toContain(`${(totalMs / 1000).toFixed(1)}s`);
  });

  it('excludes jobs with no started_at/completed_at (skipped by path-filter) from wall/work', () => {
    const withSkipped = [
      ...jobs,
      { name: 'Lighthouse (3G budgets)', started_at: null, completed_at: null },
    ];
    const a = buildSummary({ records: [], jobs, budgets: { jobs: {} } });
    const b = buildSummary({ records: [], jobs: withSkipped, budgets: { jobs: {} } });
    expect(a.markdown).toBe(b.markdown);
  });
});

describe('buildSummary — top 10 slowest files, global across suites', () => {
  it('sorts descending across every suite and truncates to 10', () => {
    const makeRecord = (suite, n) => ({
      suite,
      runner: 'vitest',
      wallMs: 0,
      workMs: 0,
      totals: { files: n, tests: n },
      files: Array.from({ length: n }, (_, i) => ({
        file: `${suite}/file${i}.spec.ts`,
        durationMs: i + 1,
        tests: 1,
        status: 'passed',
      })),
    });
    const records = [makeRecord('a', 8), makeRecord('b', 8)];
    const { markdown } = buildSummary({ records, jobs: [], budgets: { jobs: {} } });
    const topSection = markdown.split('#### Top 10 slowest files')[1];
    const rows = topSection
      .trim()
      .split('\n')
      .filter((l) => l.startsWith('| ') && !l.includes('---') && !l.includes('Suite |'));
    expect(rows).toHaveLength(10);
    // Highest durationMs across both suites (b/file7 and a/file7, both 8ms) sort first.
    expect(rows[0]).toContain('file7.spec.ts');
  });
});

describe("buildSummary — the budget gate provably fires (#436 AC 3, #356's lesson)", () => {
  const jobs = [
    {
      name: 'Frontend tests',
      started_at: '2026-01-01T00:00:00.000Z',
      completed_at: '2026-01-01T00:10:00.000Z',
    },
  ];

  it('warns and exits 0 when over budget but the job is not enforced', () => {
    const budgets = { jobs: { 'Frontend tests': { budgetSeconds: 300, enforce: false } } };
    const { markdown, warnings, exitCode } = buildSummary({ records: [], jobs, budgets });
    expect(markdown).toContain('⚠️');
    expect(warnings.some((w) => w.startsWith('::warning title=CI budget::'))).toBe(true);
    expect(exitCode).toBe(0);
  });

  it('exits 1 for the exact same breach once the job is enforced', () => {
    const budgets = { jobs: { 'Frontend tests': { budgetSeconds: 300, enforce: true } } };
    const { exitCode } = buildSummary({ records: [], jobs, budgets });
    expect(exitCode).toBe(1);
  });

  it('never warns, and always exits 0, when the job is under budget', () => {
    const budgets = { jobs: { 'Frontend tests': { budgetSeconds: 900, enforce: true } } };
    const { markdown, warnings, exitCode } = buildSummary({ records: [], jobs, budgets });
    expect(markdown).not.toContain('⚠️');
    expect(warnings).toHaveLength(0);
    expect(exitCode).toBe(0);
  });

  it('falls back to the global burnIn.enforce flag when a job has no enforce of its own', () => {
    const budgets = {
      burnIn: { enforce: true },
      jobs: { 'Frontend tests': { budgetSeconds: 300 } },
    };
    const { exitCode } = buildSummary({ records: [], jobs, budgets });
    expect(exitCode).toBe(1);
  });
});

describe('buildSummary — no budget entry never fails', () => {
  it('renders "—" and never warns for a job absent from ci-budgets.json', () => {
    const jobs = [
      {
        name: 'Some New Job',
        started_at: '2026-01-01T00:00:00.000Z',
        completed_at: '2026-01-01T00:20:00.000Z',
      },
    ];
    const { markdown, warnings, exitCode } = buildSummary({
      records: [],
      jobs,
      budgets: { jobs: {} },
    });
    expect(markdown).toContain('| Some New Job | 1200.0s | — | — |');
    expect(warnings).toHaveLength(0);
    expect(exitCode).toBe(0);
  });
});

describe('buildSummary — empty records directory', () => {
  it('still renders the Jobs table and says so in the Suites table, rather than emitting nothing', () => {
    const jobs = [
      {
        name: 'Frontend tests',
        started_at: '2026-01-01T00:00:00.000Z',
        completed_at: '2026-01-01T00:01:00.000Z',
      },
    ];
    const { markdown } = buildSummary({ records: [], jobs, budgets: { jobs: {} } });
    expect(markdown).toContain('#### Jobs');
    expect(markdown).toContain('Frontend tests');
    expect(markdown).toContain('_no suite records found_');
  });
});

describe('buildReportText (yarn test:timings, #441)', () => {
  it('prints wall (max across records) and work (sum), plus the top-10 slowest files', () => {
    const records = [
      {
        suite: 'frontend',
        wallMs: 5000,
        workMs: 12000,
        files: [{ file: 'a.test.tsx', durationMs: 900, tests: 3 }],
      },
      {
        suite: 'shared',
        wallMs: 200,
        workMs: 200,
        files: [{ file: 'b.spec.ts', durationMs: 100, tests: 1 }],
      },
    ];
    const text = buildReportText(records);
    expect(text).toContain('wall: 5.0s  work: 12.2s');
    expect(text).toContain('a.test.tsx');
    expect(text.indexOf('a.test.tsx')).toBeLessThan(text.indexOf('b.spec.ts'));
  });
});

describe('emptyRecord', () => {
  it('is schema-valid — same shape as a real record, all zeros, plus an error string', () => {
    const record = emptyRecord({
      suite: 'unit',
      runner: 'vitest',
      job: 'Build, lint, unit tests',
      error: 'boom',
    });
    expect(record.schemaVersion).toBe(1);
    expect(record.files).toEqual([]);
    expect(record.error).toBe('boom');
  });
});
