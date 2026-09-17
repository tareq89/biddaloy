// Single source of truth for the credentials the E2E suite logs in with —
// [8.5.2]. The values must match what `server/src/scripts/seed.util.ts`
// (`ROLE_TEST_USERS`) actually seeds; `seed.util.spec.ts` imports this
// file (server test suite imports the e2e contract, never the reverse)
// and fails if the two drift.
//
// Keys are `UserRole` enum values lower-cased — also used as the
// storageState file names under `e2e/.auth/`.

/** Env var holding the shared password for every seed account. */
export const SEED_PASSWORD_ENV = 'SEED_ADMIN_PASSWORD';

export const SEED_ROLE_EMAILS = {
  super_admin: 'superadmin@biddaloy.test',
  admin: 'admin@biddaloy.test',
  accountant: 'accountant@biddaloy.test',
  teacher: 'teacher@biddaloy.test',
  executive: 'executive@biddaloy.test',
  parent: 'parent@biddaloy.test',
  student: 'student@biddaloy.test',
} as const;

export type SeedRole = keyof typeof SEED_ROLE_EMAILS;

export const SEED_ROLES = Object.keys(SEED_ROLE_EMAILS) as SeedRole[];

/** [9.11] The seeded ACTIVE attendance device's key — fixed, not
 * generated, so a device-integration e2e test can authenticate without a
 * setup step of its own. Obviously fake (`bd_dev_seed_...`), and
 * `seed.util.spec.ts` asserts this matches what `seed.util.ts` actually
 * stores the hash of. */
export const SEED_DEVICE_KEY = 'bd_dev_seed_0000000000000000000000000000';

/** [9.11] Roll 1's one seeded ABSENT day in `attendance_records` — roll 1
 * is `parent@biddaloy.test`'s linked child (see `seed.util.ts`'s
 * `ensureDemoStudents` comment), so `journeys/attendance.spec.ts` reads
 * this exact date's cell in the portal calendar. Duplicated from
 * `seed.util.ts`'s `ATTENDANCE_SEED_ABSENT_DATE`; `seed.util.spec.ts`
 * asserts the two stay equal. */
export const ATTENDANCE_SEED_ABSENT_DATE = '2026-03-09';

/** [17.2.6] The platform-wide BD public-holiday sets `yarn seed` publishes
 * immediately (`ensurePublicHolidaySet` in `seed.util.ts`) — MANUAL source,
 * not fetched. Duplicated here rather than imported: this file is the
 * server's own dependency in the other direction (`seed.util.spec.ts`
 * imports *this* file, never the reverse), so importing
 * `server/src/scripts/seed-data/public-holidays-bd.ts` from here would be
 * circular. `seed.util.spec.ts` asserts these two names stay equal. */
export const SEED_PUBLIC_HOLIDAY_SETS = [
  { country: 'BD', year: 2026 },
  { country: 'BD', year: 2027 },
] as const;

/** One fixed holiday name from the 2026 BD set, for an e2e spec that just
 * needs to assert the calendar UI renders *a* published public holiday
 * without hard-coding the whole list. */
export const SEED_PUBLIC_HOLIDAY_SAMPLE_NAME = 'Independence Day';

/** [17.2.6] The default school's three demo `AcademicTerm`s, seeded by
 * `ensureCalendarDemoSeed` into `DEMO_ACADEMIC_YEAR` ("2026-2027"). Names
 * only — `seq`/date ranges are an implementation detail an e2e spec
 * shouldn't need to assert on. */
export const SEED_ACADEMIC_TERM_NAMES = ['First Term', 'Second Term', 'Third Term'] as const;

/** [17.2.6] The default school's four demo `CalendarEvent`s beyond the
 * pre-existing `HOLIDAY` seed (`ATTENDANCE_SEED_HOLIDAYS` in
 * `seed.util.ts`) — one of each remaining `CalendarEventType`. The EXAM is
 * scoped to "Class 6" and "Class 7"; the EVENT is a draft
 * (`published_at IS NULL`) on purpose, so an e2e spec asserting on
 * calendar visibility has a real unpublished row to check against. */
export const SEED_CALENDAR_EVENT_NAMES = {
  exam: 'Half-Yearly Examination',
  meeting: 'Staff Planning Meeting',
  deadline: 'Annual Report Submission Deadline',
  draftEvent: 'Winter Fair (Draft)',
} as const;
