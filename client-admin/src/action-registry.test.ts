import { Permission } from '@biddaloy/shared';
import { describe, expect, it } from 'vitest';

import { ACTIONS, type ActionContext, type PaletteAction } from './action-registry';
import { STAFF_ROUTE_PERMISSIONS } from './route-permissions';
import { UNREGISTERED_ACTIONS } from './unregistered-actions';

const VALID_KINDS = new Set(['modal', 'navigate', 'inline']);
const VALID_CONTEXTS = new Set<ActionContext>(['student', 'guardian', 'invoice', 'gradingScale']);
const PERMISSION_VALUES = new Set(Object.values(Permission));

/** `action.run()`'s `navigate({ to })` target is a real URL path (no
 * `/_staff` prefix) — that's what the router actually navigates to, same
 * convention `nav-tree.ts` uses. `STAFF_ROUTE_PERMISSIONS` is keyed by the
 * route's internal id instead (it does carry the `/_staff` prefix), so
 * checking an action's target against it needs the same translation
 * `route-permissions.test.ts`'s `NAV_PATH_TO_ROUTE_ID` already does — a
 * small subset here, only the routes seeded actions actually target. */
const NAV_PATH_TO_ROUTE_ID: Record<string, string> = {
  '/payments/record': '/_staff/payments/record',
  '/communications/send': '/_staff/communications/send',
  '/communications/reminders': '/_staff/communications/reminders',
  '/attendance': '/_staff/attendance/',
  '/fees/generate': '/_staff/fees/generate',
  '/students/new': '/_staff/students/new',
  '/students/import': '/_staff/students/import',
  '/grading-scales': '/_staff/grading-scales/',
  '/marks': '/_staff/marks/',
  '/results': '/_staff/results/',
  '/exams': '/_staff/exams/',
  '/admissions/applicants': '/_staff/admissions/applicants/',
};

/**
 * [30.4.3] The component file each seeded action's `run()` actually opens
 * (dialog or full-page form). The disjointness test below asserts none of
 * these remain in `UNREGISTERED_ACTIONS` — hand-maintained because
 * `PaletteAction.run()` only carries a route string, not a source file;
 * `unregistered-actions.ts`'s own header comment documents the same
 * "delete your lines when you register" protocol this guards.
 */
const REGISTERED_ACTION_FILES: Record<string, string> = {
  'payments.record': 'client-admin/src/routes/_staff/payments/-record/record-payment-modal.tsx',
  'communications.sendMessage': 'client-admin/src/routes/_staff/communications/send.tsx',
  'communications.sendFeeReminder': 'client-admin/src/routes/_staff/communications/reminders.tsx',
  'attendance.take': 'client-admin/src/routes/_staff/attendance/index.tsx',
  'fees.generate': 'client-admin/src/routes/_staff/fees/generate.tsx',
  'students.add': 'client-admin/src/routes/_staff/students/new.tsx',
  'students.import': 'client-admin/src/routes/_staff/students/import.tsx',
  'grading.copyScale': 'client-admin/src/routes/_staff/grading-scales/-copy-scale-dialog.tsx',
  'results.enterMarks': 'client-admin/src/routes/_staff/marks/index.tsx',
  'results.process': 'client-admin/src/routes/_staff/results/-process-dialog.tsx',
  'results.publish': 'client-admin/src/routes/_staff/results/-publish-dialog.tsx',
  'results.sendSms': 'client-admin/src/routes/_staff/results/-send-result-sms-dialog.tsx',
  'exams.copyComponents': 'client-admin/src/routes/_staff/exams/-copy-components-dialog.tsx',
};

/**
 * A syntactically valid base action, shape-guard tests below clone and
 * mutate exactly one field so each test isolates a single violation.
 */
function validAction(overrides: Partial<PaletteAction> = {}): PaletteAction {
  return {
    id: 'shape-guard.valid',
    label: { en: 'Valid action', bn: 'বৈধ কাজ' },
    permission: Permission.STUDENT_CREATE,
    kind: 'navigate',
    run: () => {},
    ...overrides,
  };
}

/** Same shape-guard predicates `ACTIONS` itself is checked against below,
 * exercised directly against a single synthetic entry so each invalid
 * shape can be asserted in isolation, with the offending id named in the
 * failure message — mirrors `route-permissions.test.ts`'s style. */
function isShapeValid(action: PaletteAction): boolean {
  if (!PERMISSION_VALUES.has(action.permission)) return false;
  if (action.label.en.length === 0 || action.label.bn.length === 0) return false;
  if (!VALID_KINDS.has(action.kind)) return false;
  if (action.context && !action.context.every((entity) => VALID_CONTEXTS.has(entity))) {
    return false;
  }
  return true;
}

describe('action-registry.ts', () => {
  it('has at least one seeded action', () => {
    expect(ACTIONS.length).toBeGreaterThan(0);
  });

  it('every id is unique', () => {
    const ids = ACTIONS.map((action) => action.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(ACTIONS.map((action) => [action.id, action] as const))(
    '%s: permission is a real Permission enum member',
    (_id, action) => {
      expect(PERMISSION_VALUES.has(action.permission)).toBe(true);
    },
  );

  it.each(ACTIONS.map((action) => [action.id, action] as const))(
    '%s: has both en and bn labels',
    (_id, action) => {
      expect(action.label.en.length).toBeGreaterThan(0);
      expect(action.label.bn.length).toBeGreaterThan(0);
    },
  );

  it.each(ACTIONS.map((action) => [action.id, action] as const))(
    '%s: kind is one of modal | navigate | inline',
    (_id, action) => {
      expect(VALID_KINDS.has(action.kind)).toBe(true);
    },
  );

  it.each(ACTIONS.map((action) => [action.id, action] as const))(
    '%s: every context entry is a known ActionContext',
    (_id, action) => {
      for (const entity of action.context ?? []) {
        expect(VALID_CONTEXTS.has(entity), `${action.id} names unknown context "${entity}"`).toBe(
          true,
        );
      }
    },
  );

  it.each(ACTIONS.map((action) => [action.id, action] as const))(
    '%s: run() calls navigate without throwing',
    (_id, action) => {
      const calls: string[] = [];
      expect(() => action.run({ navigate: (opts) => calls.push(opts.to) })).not.toThrow();
      expect(calls.length).toBe(1);
    },
  );

  it('every seeded action targets a route that exists in STAFF_ROUTE_PERMISSIONS with the same permission', () => {
    for (const action of ACTIONS) {
      const calls: string[] = [];
      action.run({ navigate: (opts) => calls.push(opts.to) });
      const [target] = calls;
      const routeId = NAV_PATH_TO_ROUTE_ID[target as keyof typeof NAV_PATH_TO_ROUTE_ID];
      expect(
        routeId,
        `no NAV_PATH_TO_ROUTE_ID entry for ${target} (action ${action.id}) — add one if this is a genuinely new seeded action`,
      ).toBeDefined();
      const routePermission =
        STAFF_ROUTE_PERMISSIONS[routeId as keyof typeof STAFF_ROUTE_PERMISSIONS];
      expect(
        routePermission,
        `no STAFF_ROUTE_PERMISSIONS entry for ${routeId} (action ${action.id})`,
      ).toBeDefined();
      expect(
        action.permission,
        `${action.id} permission (${action.permission}) does not match route ${target}'s permission (${routePermission})`,
      ).toBe(routePermission);
    }
  });

  describe('shape guard — five invalid shapes must not ship', () => {
    it('rejects an unknown permission (not a real Permission enum member)', () => {
      const action = validAction({
        id: 'shape-guard.unknown-permission',
        permission: 'not-a-real-permission' as Permission,
      });
      expect(isShapeValid(action), `${action.id} should be rejected: unknown permission`).toBe(
        false,
      );
    });

    it('rejects a missing bn label', () => {
      const action = validAction({
        id: 'shape-guard.missing-bn',
        label: { en: 'Missing bn', bn: '' },
      });
      expect(isShapeValid(action), `${action.id} should be rejected: missing bn label`).toBe(false);
    });

    it('rejects an illegal kind', () => {
      const action = validAction({
        id: 'shape-guard.illegal-kind',
        kind: 'popover' as PaletteAction['kind'],
      });
      expect(isShapeValid(action), `${action.id} should be rejected: illegal kind`).toBe(false);
    });

    it('rejects a duplicate id against the real registry', () => {
      const existingId = ACTIONS[0]?.id;
      expect(existingId, 'ACTIONS must be non-empty for this test to be meaningful').toBeDefined();
      const candidateIds = [...ACTIONS.map((action) => action.id), existingId as string];
      expect(
        new Set(candidateIds).size,
        `duplicate id "${existingId}" should be rejected`,
      ).not.toBe(candidateIds.length);
    });

    it('rejects a context naming an entity type the palette does not know', () => {
      const action = validAction({
        id: 'shape-guard.unknown-context',
        context: ['teacher' as ActionContext],
      });
      expect(
        isShapeValid(action),
        `${action.id} should be rejected: unknown context entity "teacher"`,
      ).toBe(false);
    });
  });

  describe('registered actions stay disjoint from UNREGISTERED_ACTIONS', () => {
    const unregisteredFiles = new Set(UNREGISTERED_ACTIONS.map((entry) => entry.file));

    it.each(ACTIONS.map((action) => [action.id, action] as const))(
      "%s: its backing file, if known, isn't also left in UNREGISTERED_ACTIONS",
      (_id, action) => {
        const file = REGISTERED_ACTION_FILES[action.id];
        if (!file) return; // no hand-maintained mapping for this id — nothing to assert
        expect(
          unregisteredFiles.has(file),
          `${action.id}'s file (${file}) is registered in ACTIONS but still listed in UNREGISTERED_ACTIONS — delete its entry there`,
        ).toBe(false);
      },
    );
  });
});
