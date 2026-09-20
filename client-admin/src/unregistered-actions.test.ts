import { existsSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ACTIONS } from './action-registry';
import { UNREGISTERED_ACTIONS } from './unregistered-actions';

/**
 * Real, currently-open epic ids this repo tracks (`gh issue list --state
 * open`, epic titles are `[Epic <id>]`), snapshotted 2026-09-20. Update
 * this set when an epic closes or a new one opens — that drift is exactly
 * what this test exists to catch.
 */
const KNOWN_OPEN_EPICS = new Set([
  '19.0',
  '20.0',
  '21.0',
  '22.0',
  '23.0',
  '24.0',
  '25.0',
  '26.0',
  '27.0',
  '28.0',
  '29.0',
  '30.0',
  '31.0',
  '32.0',
  '33.0',
  '34.0',
  '35.0',
  '36.0',
  '37.0',
  '38.0',
  '39.0',
  '40.0',
  '41.0',
  '8.9',
  '8.15',
  '13.0',
  '42.0',
]);

// repo root is two levels up from client-admin/src
const REPO_ROOT = path.resolve(__dirname, '..', '..');

describe('unregistered-actions.ts', () => {
  it('every listed file actually exists on disk', () => {
    for (const entry of UNREGISTERED_ACTIONS) {
      expect(existsSync(path.join(REPO_ROOT, entry.file)), `missing file: ${entry.file}`).toBe(
        true,
      );
    }
  });

  it('no file appears in both the registered ACTIONS targets and UNREGISTERED_ACTIONS', () => {
    // `PaletteAction` carries a route (`run()`'s navigate target), not a
    // source file — `unregistered-actions.ts` is keyed by file. This maps
    // each `kind: 'modal'` seeded action to the actual dialog-bearing file
    // its route mounts, verified by hand against
    // `rg -l '<Dialog|DialogContent' client-admin/src/routes` — the same
    // command `unregistered-actions.ts`'s own header comment says seeds
    // that file. `kind: 'navigate'` actions (sendFeeReminder, attendance,
    // students.import) open a full-page route, not a Dialog, so they were
    // never candidates for UNREGISTERED_ACTIONS in the first place and
    // aren't in this map.
    const registeredDialogFiles: Record<string, string> = {
      'payments.record': 'client-admin/src/routes/_staff/payments/-record/record-payment-modal.tsx',
      'communications.sendMessage': 'client-admin/src/routes/_staff/communications/send.tsx',
      'fees.generate': 'client-admin/src/routes/_staff/fees/-generate/generate-fees-modal.tsx',
      'students.add': 'client-admin/src/routes/_staff/students/new.tsx',
    };
    for (const action of ACTIONS) {
      const file = registeredDialogFiles[action.id];
      if (!file) continue; // navigate-kind or non-dialog modal, not applicable
      expect(
        UNREGISTERED_ACTIONS.some((entry) => entry.file === file),
        `${action.id} is registered in ACTIONS but its file (${file}) still appears in UNREGISTERED_ACTIONS`,
      ).toBe(false);
    }

    // UNREGISTERED_ACTIONS lists source files, not routes, so this checks
    // for the direct file-level duplicates that would indicate the same
    // dialog is claimed both as seeded and as still-unregistered.
    const unregisteredFiles = new Set(UNREGISTERED_ACTIONS.map((entry) => entry.file));
    expect(unregisteredFiles.size).toBe(UNREGISTERED_ACTIONS.length);
  });

  it('every entry names a real, known owning epic', () => {
    for (const entry of UNREGISTERED_ACTIONS) {
      expect(
        KNOWN_OPEN_EPICS.has(entry.owningEpic),
        `${entry.file} names unknown owningEpic "${entry.owningEpic}"`,
      ).toBe(true);
    }
  });

  it('has no duplicate file entries', () => {
    const files = UNREGISTERED_ACTIONS.map((entry) => entry.file);
    expect(new Set(files).size).toBe(files.length);
  });
});
