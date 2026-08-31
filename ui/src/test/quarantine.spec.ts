// [#437] Enforces "quarantine is a queue, not a graveyard" (see
// `quarantine.ts`'s module header): a hard cap on how many tests can be
// quarantined at once, a mandatory `issue` + `addedAt` on every entry, a
// 14-day expiry, and no duplicate keys. This spec *is* the enforcement
// mechanism, not just coverage of it — a stale or over-full
// `quarantine.json` fails this test, which runs in the normal, blocking
// `ui:node` bucket, so the escape hatch has its own escape hatch.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  installQuarantine,
  isExpired,
  loadQuarantine,
  MAX_QUARANTINE_ENTRIES,
  QUARANTINE_EXPIRY_DAYS,
  type QuarantineEntry,
  type QuarantineFile,
  resolveQuarantineMode,
  validateQuarantineFile,
} from './quarantine';

const NOW = new Date('2026-08-30T00:00:00.000Z');

function entry(overrides: Partial<QuarantineEntry> = {}): QuarantineEntry {
  return {
    test: 'src/foo.test.ts > some suite > some test',
    issue: 437,
    addedAt: '2026-08-25',
    reason: 'flaky under CI load',
    ...overrides,
  };
}

function file(tests: QuarantineEntry[]): QuarantineFile {
  return { schemaVersion: 1, tests };
}

describe('the committed quarantine.json', () => {
  // Deliberately the REAL clock, not the frozen NOW the synthetic cases use.
  // Checking the committed file against a fixed date would make the 14-day
  // expiry inert the moment that date passes — an entry added after NOW would
  // have a negative age and could never expire, which is exactly the
  // "graveyard" failure mode this file exists to prevent.
  it('is currently valid, as of right now', () => {
    expect(validateQuarantineFile(loadQuarantine(), new Date())).toEqual([]);
  });
});

describe('validateQuarantineFile', () => {
  it('accepts an empty list', () => {
    expect(validateQuarantineFile(file([]), NOW)).toEqual([]);
  });

  it('accepts a well-formed entry within the cap and the expiry', () => {
    expect(validateQuarantineFile(file([entry()]), NOW)).toEqual([]);
  });

  it('rejects more entries than the hard cap', () => {
    const tests = Array.from({ length: MAX_QUARANTINE_ENTRIES + 1 }, (_, i) =>
      entry({ test: `src/foo.test.ts > case ${i}` }),
    );
    const violations = validateQuarantineFile(file(tests), NOW);
    expect(violations).toEqual([expect.stringContaining('hard cap')]);
  });

  it('accepts exactly the hard cap', () => {
    const tests = Array.from({ length: MAX_QUARANTINE_ENTRIES }, (_, i) =>
      entry({ test: `src/foo.test.ts > case ${i}` }),
    );
    expect(validateQuarantineFile(file(tests), NOW)).toEqual([]);
  });

  it('rejects an entry missing an issue', () => {
    const violations = validateQuarantineFile(
      file([entry({ issue: undefined as unknown as number })]),
      NOW,
    );
    expect(violations).toEqual([expect.stringContaining('missing a tracking "issue"')]);
  });

  it('rejects an entry missing addedAt', () => {
    const violations = validateQuarantineFile(
      file([entry({ addedAt: undefined as unknown as string })]),
      NOW,
    );
    expect(violations).toEqual([expect.stringContaining('missing "addedAt"')]);
  });

  it(`rejects an entry older than ${QUARANTINE_EXPIRY_DAYS} days`, () => {
    const violations = validateQuarantineFile(file([entry({ addedAt: '2026-08-01' })]), NOW);
    expect(violations).toEqual([expect.stringContaining('more than 14 days ago')]);
  });

  it(`accepts an entry exactly at the ${QUARANTINE_EXPIRY_DAYS}-day boundary`, () => {
    const violations = validateQuarantineFile(file([entry({ addedAt: '2026-08-16' })]), NOW);
    expect(violations).toEqual([]);
  });

  it('rejects duplicate keys', () => {
    const violations = validateQuarantineFile(
      file([entry({ test: 'same > key' }), entry({ test: 'same > key' })]),
      NOW,
    );
    expect(violations).toEqual([expect.stringContaining('duplicate quarantine entry')]);
  });

  it('rejects a non-array "tests" field instead of throwing', () => {
    const violations = validateQuarantineFile(
      { schemaVersion: 1, tests: 'not-an-array' } as unknown as QuarantineFile,
      NOW,
    );
    expect(violations).toEqual([expect.stringContaining('must be an array')]);
  });

  it('rejects a null entry instead of throwing', () => {
    const violations = validateQuarantineFile(
      file([null as unknown as QuarantineEntry]),
      NOW,
    );
    expect(violations).toEqual([expect.stringContaining('malformed entry')]);
  });
});

describe('installQuarantine tolerating a malformed quarantine.json', () => {
  // Mirrors the two shapes validateQuarantineFile above rejects.
  // installQuarantine must survive them too — it runs from every frontend
  // test file's setup, so throwing here would take down the whole suite,
  // not just fail the one test meant to catch a bad quarantine.json.
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function writeQuarantineFile(contents: unknown): string {
    dir = mkdtempSync(join(tmpdir(), 'quarantine-test-'));
    const path = join(dir, 'quarantine.json');
    writeFileSync(path, JSON.stringify(contents));
    return path;
  }

  it('does not throw when "tests" is not an array', () => {
    const path = writeQuarantineFile({ schemaVersion: 1, tests: 'not-an-array' });
    expect(() => installQuarantine({ path })).not.toThrow();
  });

  it('does not throw when an entry is null', () => {
    const path = writeQuarantineFile({ schemaVersion: 1, tests: [null] });
    expect(() => installQuarantine({ path })).not.toThrow();
  });
});

describe('resolveQuarantineMode', () => {
  it('defaults to "skip" when unset', () => {
    expect(resolveQuarantineMode(undefined)).toBe('skip');
  });

  it('is "only" only for the exact literal "only"', () => {
    expect(resolveQuarantineMode('only')).toBe('only');
  });

  it('falls back to "skip" for any other value, not just unset', () => {
    expect(resolveQuarantineMode('Only')).toBe('skip');
    expect(resolveQuarantineMode('skip')).toBe('skip');
    expect(resolveQuarantineMode('')).toBe('skip');
  });
});

describe('isExpired', () => {
  it('is false for an entry added today', () => {
    expect(isExpired(entry({ addedAt: '2026-08-30' }), NOW)).toBe(false);
  });

  it('is true for an entry older than the expiry window', () => {
    expect(isExpired(entry({ addedAt: '2026-08-01' }), NOW)).toBe(true);
  });

  it('is true for an unparseable addedAt, rather than silently passing', () => {
    expect(isExpired(entry({ addedAt: 'not-a-date' }), NOW)).toBe(true);
  });
});
