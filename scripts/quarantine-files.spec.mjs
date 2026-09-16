// [18.1.1] Fixture-driven coverage for scripts/quarantine-files.mjs — the
// script ci.yml's "Quarantined frontend tests (non-blocking)" step uses to
// scope its run to only the quarantined files, instead of transforming and
// importing the whole ~200-file frontend suite to find them.
import { describe, expect, it } from 'vitest';

import { quarantineFiles } from './quarantine-files.mjs';

function entry(overrides = {}) {
  return {
    test: 'client-admin/src/routes/_staff/students/index.test.tsx > /students > gates Collect fees',
    issue: 475,
    addedAt: '2026-09-07',
    reason: 'flaky under CI load',
    ...overrides,
  };
}

describe('quarantineFiles', () => {
  it('returns nothing for an empty list', () => {
    expect(quarantineFiles([])).toEqual([]);
  });

  it('returns nothing for a non-array input', () => {
    expect(quarantineFiles(undefined)).toEqual([]);
    expect(quarantineFiles(null)).toEqual([]);
  });

  it('extracts the file segment before the first " > "', () => {
    expect(quarantineFiles([entry()])).toEqual([
      'client-admin/src/routes/_staff/students/index.test.tsx',
    ]);
  });

  it('de-duplicates files shared by multiple quarantined tests', () => {
    const entries = [
      entry({ test: 'ui/src/foo.test.ts > suite > a' }),
      entry({ test: 'ui/src/foo.test.ts > suite > b' }),
      entry({ test: 'ui/src/bar.test.ts > suite > c' }),
    ];
    expect(quarantineFiles(entries)).toEqual(['ui/src/foo.test.ts', 'ui/src/bar.test.ts']);
  });

  it('skips malformed entries rather than throwing', () => {
    const entries = [null, {}, { test: 42 }, { test: '' }, entry()];
    expect(quarantineFiles(entries)).toEqual([
      'client-admin/src/routes/_staff/students/index.test.tsx',
    ]);
  });

  it('treats a test field with no " > " separator as its own file', () => {
    expect(quarantineFiles([entry({ test: 'ui/src/foo.test.ts' })])).toEqual([
      'ui/src/foo.test.ts',
    ]);
  });
});
