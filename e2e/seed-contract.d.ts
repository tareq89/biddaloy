/** Env var holding the shared password for every seed account. */
export declare const SEED_PASSWORD_ENV = 'SEED_ADMIN_PASSWORD';
export declare const SEED_ROLE_EMAILS: {
  readonly super_admin: 'superadmin@biddaloy.test';
  readonly admin: 'admin@biddaloy.test';
  readonly accountant: 'accountant@biddaloy.test';
  readonly teacher: 'teacher@biddaloy.test';
  readonly executive: 'executive@biddaloy.test';
  readonly parent: 'parent@biddaloy.test';
  readonly student: 'student@biddaloy.test';
};
export type SeedRole = keyof typeof SEED_ROLE_EMAILS;
export declare const SEED_ROLES: SeedRole[];
/** [9.11] The seeded ACTIVE attendance device's key — fixed, not
 * generated, so a device-integration e2e test can authenticate without a
 * setup step of its own. Obviously fake (`bd_dev_seed_...`), and
 * `seed.util.spec.ts` asserts this matches what `seed.util.ts` actually
 * stores the hash of. */
export declare const SEED_DEVICE_KEY = 'bd_dev_seed_0000000000000000000000000000';
/** [9.11] Roll 1's one seeded ABSENT day in `attendance_records` — roll 1
 * is `parent@biddaloy.test`'s linked child (see `seed.util.ts`'s
 * `ensureDemoStudents` comment), so `journeys/attendance.spec.ts` reads
 * this exact date's cell in the portal calendar. Duplicated from
 * `seed.util.ts`'s `ATTENDANCE_SEED_ABSENT_DATE`; `seed.util.spec.ts`
 * asserts the two stay equal. */
export declare const ATTENDANCE_SEED_ABSENT_DATE = '2026-03-09';
/** [17.2.6] The platform-wide BD public-holiday sets `yarn seed` publishes
 * immediately (`ensurePublicHolidaySet` in `seed.util.ts`) — MANUAL source,
 * not fetched. Duplicated here rather than imported: this file is the
 * server's own dependency in the other direction (`seed.util.spec.ts`
 * imports *this* file, never the reverse), so importing
 * `server/src/scripts/seed-data/public-holidays-bd.ts` from here would be
 * circular. `seed.util.spec.ts` asserts these two names stay equal. */
export declare const SEED_PUBLIC_HOLIDAY_SETS: readonly [
  {
    readonly country: 'BD';
    readonly year: 2026;
  },
  {
    readonly country: 'BD';
    readonly year: 2027;
  },
];
/** One fixed holiday name from the 2026 BD set, for an e2e spec that just
 * needs to assert the calendar UI renders *a* published public holiday
 * without hard-coding the whole list. */
export declare const SEED_PUBLIC_HOLIDAY_SAMPLE_NAME = 'Independence Day';
/** [17.2.6] The default school's three demo `AcademicTerm`s, seeded by
 * `ensureCalendarDemoSeed` into `DEMO_ACADEMIC_YEAR` ("2026-2027"). Names
 * only — `seq`/date ranges are an implementation detail an e2e spec
 * shouldn't need to assert on. */
export declare const SEED_ACADEMIC_TERM_NAMES: readonly ['First Term', 'Second Term', 'Third Term'];
/** [17.2.6] The default school's four demo `CalendarEvent`s beyond the
 * pre-existing `HOLIDAY` seed (`ATTENDANCE_SEED_HOLIDAYS` in
 * `seed.util.ts`) — one of each remaining `CalendarEventType`. The EXAM is
 * scoped to "Class 6" and "Class 7"; the EVENT is a draft
 * (`published_at IS NULL`) on purpose, so an e2e spec asserting on
 * calendar visibility has a real unpublished row to check against. */
export declare const SEED_CALENDAR_EVENT_NAMES: {
  readonly exam: 'Half-Yearly Examination';
  readonly meeting: 'Staff Planning Meeting';
  readonly deadline: 'Annual Report Submission Deadline';
  readonly draftEvent: 'Winter Fair (Draft)';
};
/** [34.2.4] `ensureProgramsDemoSeed`/`ensureProgramParticipationDemoSeed` in
 * `seed.util.ts` seed a "Hifz" program (and a "Debate club" one) with real
 * `id`s — generated, not fixed, so unlike `SEED_DEVICE_KEY` above there is
 * no id to duplicate here. Name only, the same "expose what's stable, look
 * up the rest at runtime" convention `ensureGradingScale` in `e2e/api.ts`
 * uses for the seeded grading scale. `programs.spec.ts` finds the program
 * by this name via the command palette / UI, not by id. */
export declare const SEED_PROGRAM_NAME = 'Hifz';
/** [39.1.4] Demo students `ensureStudentLifecycleSeed` (`seed.ts`) gives
 * lifecycle history, addressed by registration number. Duplicated from
 * `seed.ts`; `seed.spec.ts` asserts the seeded rows match. */
export declare const SEED_LIFECYCLE_STUDENTS: {
  readonly withdrawnThenReadmitted: '2026-2027-0001';
  readonly transferredOut: '2026-2027-0002';
  readonly graduated: '2026-2027-0003';
};
/** [39.1.4] Destination text on the TRANSFERRED_OUT event. */
export declare const SEED_TRANSFER_DESTINATION = 'Dhaka Residential Model College';
//# sourceMappingURL=seed-contract.d.ts.map
