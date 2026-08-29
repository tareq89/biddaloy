// [#437] Fixture-driven coverage for scripts/flake-report.mjs — feeds it
// synthetic Vitest `--reporter=json` pass results and asserts the
// flake/real-failure classification and the markdown it renders.
import { describe, expect, it } from 'vitest';

import { buildReportMarkdown, classify, extractResults } from './flake-report.mjs';

// Vitest's JSON reporter writes an ABSOLUTE path in `name` and joins
// `fullName` with spaces — the fixture must model that, not a convenient
// shape, or it silently blesses a key that can never match a quarantine
// entry (which is exactly what it did before #437's review).
const REPO = '/repo';

function passReport(assertions) {
  return {
    testResults: [
      {
        name: '/repo/ui/src/foo.test.ts',
        assertionResults: assertions.map(({ title, status, ancestorTitles = ['suite'] }) => ({
          ancestorTitles,
          fullName: `${ancestorTitles.join(' ')} ${title}`.trim(),
          title,
          status,
        })),
      },
    ],
  };
}

describe('extractResults', () => {
  it('emits a repo-relative key whose suite chain is joined with " > "', () => {
    const results = extractResults(passReport([{ title: 'a', status: 'passed' }]), REPO);
    expect(results).toEqual([
      {
        key: 'ui/src/foo.test.ts > suite > a',
        file: 'ui/src/foo.test.ts',
        testName: 'suite > a',
        status: 'passed',
      },
    ]);
  });

  // The one property that actually matters: the key this report prints must
  // be pasteable into quarantine.json. quarantine.ts builds the same string
  // from the repo-relative path plus the ' > '-joined suite chain, so if
  // these two ever drift, quarantining a test found here silently no-ops.
  it('produces the same key shape quarantine.ts matches on', () => {
    const [result] = extractResults(
      passReport([{ title: 'does a thing', status: 'failed', ancestorTitles: ['outer', 'inner'] }]),
      REPO,
    );
    expect(result.key).toBe('ui/src/foo.test.ts > outer > inner > does a thing');
  });

  it('degrades to an empty list for a report with no testResults', () => {
    expect(extractResults({})).toEqual([]);
    expect(extractResults(null)).toEqual([]);
  });
});

describe('classify', () => {
  it('is a flake: failed in one pass, passed in another', () => {
    const passes = [
      passReport([{ title: 'flaky one', status: 'failed' }]),
      passReport([{ title: 'flaky one', status: 'passed' }]),
      passReport([{ title: 'flaky one', status: 'passed' }]),
    ];
    const { flaky, realFailures } = classify(passes, REPO);
    expect(flaky).toHaveLength(1);
    expect(flaky[0].key).toBe('ui/src/foo.test.ts > suite > flaky one');
    expect(realFailures).toHaveLength(0);
  });

  it('is a real failure: failed in every pass', () => {
    const passes = [
      passReport([{ title: 'always broken', status: 'failed' }]),
      passReport([{ title: 'always broken', status: 'failed' }]),
      passReport([{ title: 'always broken', status: 'failed' }]),
    ];
    const { flaky, realFailures } = classify(passes, REPO);
    expect(flaky).toHaveLength(0);
    expect(realFailures).toHaveLength(1);
    expect(realFailures[0].key).toBe('ui/src/foo.test.ts > suite > always broken');
  });

  it('is neither: passed every pass', () => {
    const passes = [
      passReport([{ title: 'solid', status: 'passed' }]),
      passReport([{ title: 'solid', status: 'passed' }]),
      passReport([{ title: 'solid', status: 'passed' }]),
    ];
    const { flaky, realFailures } = classify(passes, REPO);
    expect(flaky).toHaveLength(0);
    expect(realFailures).toHaveLength(0);
  });

  it('classifies each test in a mixed run independently', () => {
    const passes = [
      passReport([
        { title: 'flaky one', status: 'failed' },
        { title: 'always broken', status: 'failed' },
        { title: 'solid', status: 'passed' },
      ]),
      passReport([
        { title: 'flaky one', status: 'passed' },
        { title: 'always broken', status: 'failed' },
        { title: 'solid', status: 'passed' },
      ]),
    ];
    const { flaky, realFailures, passCount } = classify(passes, REPO);
    expect(flaky.map((e) => e.testName)).toEqual(['suite > flaky one']);
    expect(realFailures.map((e) => e.testName)).toEqual(['suite > always broken']);
    expect(passCount).toBe(2);
  });

  it('skips a pass file that failed to parse rather than crashing', () => {
    const { flaky, realFailures } = classify([{ testResults: [] }, passReport([])], REPO);
    expect(flaky).toEqual([]);
    expect(realFailures).toEqual([]);
  });
});

describe('buildReportMarkdown', () => {
  it('reports all-green when there is nothing to report', () => {
    const markdown = buildReportMarkdown({ flaky: [], realFailures: [], passCount: 3 });
    expect(markdown).toContain('All green across 3 passes');
  });

  it('lists flaky tests with a copy-pasteable key and a pass/fail glyph row', () => {
    const markdown = buildReportMarkdown({
      flaky: [
        {
          key: 'ui/src/foo.test.ts > suite > flaky one',
          file: 'src/foo.test.ts',
          testName: 'suite flaky one',
          statuses: ['failed', 'passed', 'passed'],
        },
      ],
      realFailures: [],
      passCount: 3,
    });
    expect(markdown).toContain('Flaky');
    expect(markdown).toContain('`ui/src/foo.test.ts > suite > flaky one`');
    expect(markdown).toContain('quarantine.json');
  });

  it('lists real failures in a separate section that says not to quarantine', () => {
    const markdown = buildReportMarkdown({
      flaky: [],
      realFailures: [
        {
          key: 'ui/src/foo.test.ts > suite > always broken',
          file: 'src/foo.test.ts',
          testName: 'suite > always broken',
          statuses: ['failed', 'failed', 'failed'],
        },
      ],
      passCount: 3,
    });
    expect(markdown).toContain('not a flake');
    expect(markdown).toContain('`ui/src/foo.test.ts > suite > always broken`');
  });
});
