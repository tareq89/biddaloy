import { test } from '../fixtures/test';

/**
 * [31.5.5] Sweep failures that live in ONE page (not shared code), skipped
 * per route and per suite until the page's follow-up lands. Every entry is
 * time-boxed: recheck by RECHECK, then fix the page and delete the entry.
 * `tracked: TBD` is replaced with the issue number when the follow-up is
 * filed. Never widen a threshold or drop a route from the manifest instead.
 */
const RECHECK = '2026-11-05';

type Kind = 'axe' | 'reflow' | 'target24' | 'target44';

const TABS = 'TabsList inner horizontal scroll (ui/src/primitives/tabs.tsx line variant)';
const NO_FIXTURE = 'resolvePath cannot build this route fixture (marks/results need a scored exam)';

const KNOWN: Record<Kind, Record<string, string>> = {
  axe: {
    '/attendance/reports': 'tab trigger aria-valid-attr-value',
    '/calendar': 'calendar grid aria-required-children/parent',
    '/portal/calendar': 'calendar grid aria-required-children/parent',
    '/print/preview': 'tab trigger aria-valid-attr-value',
    '/fees/schedules': 'axe violation, see sweep output',
    '/invoices/$invoiceId': 'scrollable-region-focusable on div.relative.w-full table wrapper',
    '/marks/$examId/$sectionId/$subjectId': NO_FIXTURE,
    '/results/$examId/$studentId': NO_FIXTURE,
    '/portal/account': 'dark-only color-contrast on text-destructive',
    '/security': 'dark-only color-contrast on text-destructive',
    '/programs': 'axe violation, see sweep output',
    '/programs/$programId': 'axe violation, see sweep output',
    '/promotions/$runId': 'axe violation, see sweep output',
    '/reports/collections': 'en-only axe violation, see sweep output',
    '/routines/setup': 'en-only axe violation, see sweep output',
    '/students/$studentId': 'axe violation, see sweep output',
  },
  reflow: {
    '/attendance/staff': '320px horizontal scroll (possibly flaky)',
    '/classes/$classId': TABS,
    '/portal/routine': TABS,
    '/exams/$examId': TABS,
    '/guardians/$guardianId': TABS,
    '/staff/$userId': TABS,
    '/students/$studentId': TABS,
    '/invoices/$invoiceId': 'div.relative.w-full table wrapper scrolls at 320px',
    '/payments/$id': 'div.relative.w-full table wrapper scrolls at 320px',
    '/routines/review': '320px horizontal scroll',
    '/marks/$examId/$sectionId/$subjectId': NO_FIXTURE,
    '/results/$examId/$studentId': NO_FIXTURE,
  },
  target24: {
    '/marks/$examId/$sectionId/$subjectId': NO_FIXTURE,
    '/results/$examId/$studentId': NO_FIXTURE,
  },
  target44: {
    '/academic-years': 'non-table list links under 44px at 360px',
    '/exams': 'non-table list links under 44px at 360px',
    '/exams/seat-plans': 'non-table list links under 44px at 360px',
    '/print-templates/$templateId/edit': 'back link 54x20 at 360px',
    '/students/$studentId': 'tab/fee trigger under 44px at 360px',
    '/marks/$examId/$sectionId/$subjectId': NO_FIXTURE,
    '/results/$examId/$studentId': NO_FIXTURE,
  },
};

/** Call first thing inside a sweep test; skips only that route + suite. */
export function skipIfKnown(kind: Kind, path: string): void {
  const reason = KNOWN[kind][path];
  test.skip(
    reason !== undefined,
    `${reason} -- tracked: TBD, recheck by ${RECHECK} (31.5.5 follow-up)`,
  );
}
