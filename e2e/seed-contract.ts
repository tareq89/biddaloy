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
