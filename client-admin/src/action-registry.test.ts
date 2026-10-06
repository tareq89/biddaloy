import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { Permission } from '@biddaloy/shared';
import { describe, expect, it } from 'vitest';

import { ACTIONS, type ActionContext, type PaletteAction } from './action-registry';
import { STAFF_ROUTE_PERMISSIONS } from './route-permissions';
import { PALETTE_ALLOW_LIST, UNREGISTERED_ACTIONS } from './unregistered-actions';

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
  '/staff/evaluations?startAcr=1': '/_staff/staff/evaluations',
  '/staff/evaluations?reportIncident=1': '/_staff/staff/evaluations',
  '/staff/evaluations?publishSurvey=1': '/_staff/staff/evaluations',
  '/curriculum-preset': '/_staff/curriculum-preset',
  '/roles': '/_staff/roles/',
  '/exams?create=1': '/_staff/exams/',
  '/exams/seat-plans?generate=1': '/_staff/exams/seat-plans/',
  '/programs?new=1': '/_staff/programs/',
  '/programs?enrol=1': '/_staff/programs/',
  '/programs?record=1': '/_staff/programs/',
  '/exams/seat-plans': '/_staff/exams/seat-plans/',
  '/print/preview?kind=STUDENT_ID_CARD&subject_type=STUDENT': '/_staff/print/preview',
  '/print/preview?kind=STAFF_ID_CARD&subject_type=STAFF': '/_staff/print/preview',
  '/print-templates?new=1': '/_staff/print-templates/',
  '/reports/printables': '/_staff/reports/printables',
  '/settings#printers-section': '/_staff/settings',
  '/communications/send': '/_staff/communications/send',
  '/communications/reminders': '/_staff/communications/reminders',
  '/attendance': '/_staff/attendance/',
  '/attendance?status=pending': '/_staff/attendance/',
  '/attendance/register?edit=true': '/_staff/attendance/register',
  '/attendance/staff': '/_staff/attendance/staff/',
  '/attendance/staff/leave': '/_staff/attendance/staff/leave',
  '/fees/generate?generate=1': '/_staff/fees/generate',
  '/academic-years?new=1': '/_staff/academic-years/',
  '/classes?new=1': '/_staff/classes/',
  '/calendar?panel=new-event': '/_staff/calendar/',
  '/calendar?panel=holidays': '/_staff/calendar/',
  '/calendar?panel=clone': '/_staff/calendar/',
  '/calendar/import': '/_staff/calendar/import',
  '/fee-structures?new=1': '/_staff/fee-structures/',
  '/fees/schedules?new=1': '/_staff/fees/schedules/',
  '/guardians?invite=1': '/_staff/guardians/',
  '/staff?new=1': '/_staff/staff/',
  '/staff?promote=1': '/_staff/staff/',
  '/grading-scales?new=1': '/_staff/grading-scales/',
  '/exams/templates?new=1': '/_staff/exams/templates/',
  '/students?photos=1': '/_staff/students/',
  '/settings?section=communication': '/_staff/settings',
  '/settings?section=finance': '/_staff/settings',
  '/settings?section=backup': '/_staff/settings',
  '/students?openPerformance=1': '/_staff/students/',
  '/fees/fines?logFine=1': '/_staff/fees/fines/',
  '/fees/fines?generateFines=1': '/_staff/fees/fines/',
  '/fees/fines': '/_staff/fees/fines/',
  '/students/new': '/_staff/students/new',
  '/students/import': '/_staff/students/import',
  '/grading-scales': '/_staff/grading-scales/',
  '/routines/review': '/_staff/routines/review',
  '/routines/my': '/_staff/routines/my',
  '/my-class': '/_staff/my-class/',
  '/my-class?then=attendance': '/_staff/my-class/',
  '/routines/substitutions': '/_staff/routines/substitutions',
  '/marks': '/_staff/marks/',
  '/results': '/_staff/results/',
  '/exams': '/_staff/exams/',
  '/admissions/applicants': '/_staff/admissions/applicants/',
  '/academics/homework/new': '/_staff/academics/homework/new',
  '/academics/homework/import': '/_staff/academics/homework/import',
  '/academics/syllabus': '/_staff/academics/syllabus/',
  '/analysis': '/_staff/analysis/',
  '/promotions/new': '/_staff/promotions/new',
  '/staff': '/_staff/staff/',
  '/staff/teaching-assignments': '/_staff/staff/teaching-assignments',
};

/**
 * [30.4.3] The component file each seeded action's `run()` actually opens
 * (dialog or full-page form). The disjointness test below asserts none of
 * these remain in `UNREGISTERED_ACTIONS` — hand-maintained because
 * `PaletteAction.run()` only carries a route string, not a source file;
 * `unregistered-actions.ts`'s own header comment documents the same
 * "delete your lines when you register" protocol this guards.
 */
const R = 'client-admin/src/routes/';
const REGISTERED_ACTION_FILES: Record<string, string> = {
  'payments.record': 'client-admin/src/routes/_staff/payments/-record/record-payment-modal.tsx',
  'seatPlans.generate':
    'client-admin/src/routes/_staff/exams/seat-plans/-generate-seat-plan-modal.tsx',
  'communications.sendMessage': 'client-admin/src/routes/_staff/communications/send.tsx',
  'communications.sendFeeReminder': 'client-admin/src/routes/_staff/communications/reminders.tsx',
  'attendance.take': 'client-admin/src/routes/_staff/attendance/index.tsx',
  'attendance.register.edit': 'client-admin/src/routes/_staff/attendance/register.tsx',
  'attendance.markStaff': 'client-admin/src/routes/_staff/attendance/staff/index.tsx',
  'leave.record': `${R}_staff/attendance/staff/-leave-request-dialog.tsx`,
  'fees.generate': `${R}_staff/fees/-generate/generate-fees-modal.tsx`,
  'fines.log': `${R}_staff/fees/fines/-modals/log-fine-modal.tsx`,
  'fines.generate': `${R}_staff/fees/fines/-modals/generate-fines-modal.tsx`,
  'fines.waive': `${R}_staff/fees/fines/-modals/waive-fine-dialog.tsx`,
  'programs.add': `${R}_staff/programs/-program-form-dialog.tsx`,
  'programs.enrol': `${R}_staff/programs/-enrol-dialog.tsx`,
  'programs.recordMilestone': `${R}_staff/programs/-record-dialog.tsx`,
  'acr.start': `${R}_staff/staff/-detail/start-acr-dialog.tsx`,
  'incidents.report': `${R}_staff/staff/-detail/report-incident-dialog.tsx`,
  'surveys.publish': `${R}_staff/staff/-evaluations/survey-form-dialog.tsx`,
  'seatPlans.publish': `${R}_staff/exams/seat-plans/-publish-dialog.tsx`,
  'examTemplates.createExam': `${R}_staff/exams/-exam-form-dialog.tsx`,
  'academicYears.create': `${R}_staff/academic-years/-year-form-dialog.tsx`,
  'classes.create': `${R}_staff/classes/-class-form-dialog.tsx`,
  'calendar.addEvent': `${R}_staff/calendar/-event-form-dialog.tsx`,
  'calendar.addGovernmentHolidays': `${R}_staff/calendar/-government-holidays-dialog.tsx`,
  'calendar.copyFromYear': `${R}_staff/calendar/-clone-dialog.tsx`,
  'calendar.import': `${R}_staff/calendar/import.tsx`,
  'feeStructures.create': `${R}_staff/fee-structures/-structure-form-dialog.tsx`,
  'feeSchedules.create': `${R}_staff/fees/schedules/-schedule-form-dialog.tsx`,
  'guardians.invite': `${R}_staff/guardians/-invite-guardians-dialog.tsx`,
  'staff.add': `${R}_staff/staff/-add-user-dialog.tsx`,
  'staff.makeTeacher': `${R}_staff/staff/-promote-teacher-dialog.tsx`,
  'grading.createScale': `${R}_staff/grading-scales/index.tsx`,
  'examTemplates.create': `${R}_staff/exams/-template-form-dialog.tsx`,
  'students.uploadPhotos': `${R}_staff/students/-bulk-photo-dialog.tsx`,
  'students.add': 'client-admin/src/routes/_staff/students/new.tsx',
  'students.import': 'client-admin/src/routes/_staff/students/import.tsx',
  'grading.copyScale': 'client-admin/src/routes/_staff/grading-scales/-copy-scale-dialog.tsx',
  'my-class.open': 'client-admin/src/routes/_staff/my-class/index.tsx',
  'my-class.take-attendance': 'client-admin/src/routes/_staff/my-class/index.tsx',
  'routines.openMyRoutine': 'client-admin/src/routes/_staff/routines/my.tsx',
  'routines.addSubstitution': `${R}_staff/routines/-substitution-dialog.tsx`,
  'routines.copyLastYearRoutine': 'client-admin/src/routes/_staff/routines/review.tsx',
  'results.enterMarks': 'client-admin/src/routes/_staff/marks/index.tsx',
  'results.process': 'client-admin/src/routes/_staff/results/-process-dialog.tsx',
  'results.publish': 'client-admin/src/routes/_staff/results/-publish-dialog.tsx',
  'results.sendSms': 'client-admin/src/routes/_staff/results/-send-result-sms-dialog.tsx',
  'exams.copyComponents': 'client-admin/src/routes/_staff/exams/-copy-components-dialog.tsx',
  'homework.assign': 'client-admin/src/routes/_staff/academics/homework/new.tsx',
  'homework.import': 'client-admin/src/routes/_staff/academics/homework/import.tsx',
  'syllabus.markTopic': 'client-admin/src/routes/_staff/academics/syllabus/index.tsx',
  'promotions.promote': 'client-admin/src/routes/_staff/promotions/new.tsx',
  'print.studentIdCard': 'client-admin/src/components/print/print-id-card-modal.tsx',
  'print.staffIdCard': 'client-admin/src/components/print/print-id-card-modal.tsx',
  'print.newTemplate': 'client-admin/src/components/print/library/new-template-dialog.tsx',
  'print.history': 'client-admin/src/components/print/history/print-history-page.tsx',
  'print.printers': 'client-admin/src/pages/settings/PrintersSection.tsx',
  'staff.assignTeacher': 'client-admin/src/routes/_staff/staff/teaching-assignments.tsx',
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

  /**
   * [34.4.3] `/_staff/programs/` is a shared list route (`STAFF_ROUTE_PERMISSIONS`
   * gates it at `PROGRAM_READ` so any viewer can see the list), but two of its
   * query-param actions open dialogs the page itself further restricts to
   * `canManage` (`PROGRAM_MANAGE`) — see `programs/index.tsx`. A viewer with
   * only `PROGRAM_READ`/`PROGRAM_RECORD` must not see "Add program" /
   * "Enrol students" in the palette (it would be a silent no-op click), so
   * these two are the one documented exception to the route-permission
   * equality this test otherwise enforces everywhere.
   */
  // [38.4.3] `fines.log`/`fines.generate`/`fines.waive` are stricter than
  // `/_staff/fees/fines/`'s own FEE_READ gate on purpose — see
  // `action-registry.ts`'s comment on those three entries.
  const ROUTE_PERMISSION_EXCEPTIONS = new Set([
    'programs.add',
    'programs.enrol',
    'fines.log',
    'fines.generate',
    'fines.waive',
    // [28.3.2] ACR_WRITE is stricter than `/staff`'s USER_READ gate — see
    // `action-registry.ts`'s comment on `acr.start`.
    'acr.start',
    'incidents.report',
    'surveys.publish',
    // [28.4.5] MARK_VIEW (the Performance tab's gate) is stricter than the
    // student list's STUDENT_READ.
    'performance.open',
    // [31.5.1b] The page's button is gated tighter than the list route's read gate.
    'calendar.addEvent',
    'calendar.addGovernmentHolidays',
    'calendar.copyFromYear',
    'feeStructures.create',
    'guardians.invite',
    'staff.add',
    'staff.makeTeacher',
    'students.uploadPhotos',
    // [41.4.7] Edit mode needs ATTENDANCE_MARK; the register route is read-gated.
    'attendance.register.edit',
  ]);

  it('every seeded action targets a route that exists in STAFF_ROUTE_PERMISSIONS with the same permission (or a documented, stricter exception)', () => {
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
      if (ROUTE_PERMISSION_EXCEPTIONS.has(action.id)) continue;
      expect(
        action.permission,
        `${action.id} permission (${action.permission}) does not match route ${target}'s permission (${routePermission}) — if this is intentional (the route is broader than the action), add it to ROUTE_PERMISSION_EXCEPTIONS with a comment explaining why`,
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
  describe('palette coverage (D35)', () => {
    const REPO_ROOT = path.resolve(__dirname, '..', '..');
    const DIALOG_MARKUP = /<Dialog\b|DialogContent|<Sheet\b|SheetContent|<FullPageShell\b/;
    const routesDir = path.join(REPO_ROOT, R);

    it('every dialog file under routes is registered, allow-listed or deferred', () => {
      const covered = new Set([
        ...Object.values(REGISTERED_ACTION_FILES),
        ...PALETTE_ALLOW_LIST.map((entry) => entry.file),
        ...UNREGISTERED_ACTIONS.map((entry) => entry.file),
      ]);
      const dialogFiles = (readdirSync(routesDir, { recursive: true }) as string[])
        .filter((file) => file.endsWith('.tsx') && !/\.(test|stories)\./.test(file))
        .map((file) => R + file.split(path.sep).join('/'))
        .filter((file) => DIALOG_MARKUP.test(readFileSync(path.join(REPO_ROOT, file), 'utf8')));
      const missing = dialogFiles.filter((file) => !covered.has(file));
      expect(
        missing,
        `Dialog file(s) with no palette decision: ${missing.join(', ')}. Fix: (1) register an action in ACTIONS and add its id to REGISTERED_ACTION_FILES, (2) add it to PALETTE_ALLOW_LIST with a reason, or (3) add it to UNREGISTERED_ACTIONS with an owning epic.`,
      ).toEqual([]);
    });

    it.each(
      ACTIONS.flatMap((action) => {
        const calls: string[] = [];
        action.run({ navigate: (opts) => calls.push(opts.to) });
        const [target = ''] = calls;
        return target.includes('?') ? [[action.id, target] as const] : [];
      }),
    )('%s: the page declares the search flag %s navigates to', (_id, target) => {
      const query = target.split('#')[0]?.split('?')[1] ?? '';
      const routeId = NAV_PATH_TO_ROUTE_ID[target];
      expect(routeId, `no NAV_PATH_TO_ROUTE_ID entry for ${target}`).toBeDefined();
      const suffix = (routeId as string).replace('/_staff', '_staff');
      const rel = suffix.endsWith('/') ? `${suffix}index.tsx` : `${suffix}.tsx`;
      const source = readFileSync(path.join(routesDir, rel), 'utf8');
      for (const [key, value] of new URLSearchParams(query)) {
        expect(
          new RegExp(`\\b${key}\\s*:`).test(source),
          `${rel} does not declare the "${key}" search key (${target}) - the page would ignore it`,
        ).toBe(true);
        if (key === 'panel' || key === 'section') {
          // `section` ids live in the shared settings category list, not the route file.
          const enumSource =
            key === 'section'
              ? readFileSync(path.join(__dirname, 'pages/settings/settings-categories.ts'), 'utf8')
              : source;
          expect(enumSource, `${rel} does not know ${key}='${value}'`).toContain(`'${value}'`);
        }
      }
    });
  });
});
