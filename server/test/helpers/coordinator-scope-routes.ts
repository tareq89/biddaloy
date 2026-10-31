/**
 * [83.0.2] The routes Epic 83 widens for a coordinator (reads) and the ones it must not touch
 * (writes, and the teaching-only fees / communications reads, D5). `coordinator-scope.e2e-spec.ts`
 * walks each one before and after a coordinator row exists. Each entry names the gate it
 * exercises, so a reader can find the call site.
 *
 * `path` builds the URL from the fixture ids: `s` = a student of the section under test, `g` = its
 * guardian, `sec` = the section.
 */
export interface ScopeIds {
  s: string;
  g: string;
  sec: string;
}

export interface ScopeRoute {
  name: string;
  method: 'get' | 'put' | 'post';
  path: (ids: ScopeIds) => string;
  gate: string;
}

/** Reads a coordinator gets for their classes (D4). Outside: 404, like any teacher miss. */
export const COORDINATOR_READ_ROUTES: ScopeRoute[] = [
  {
    name: 'student detail',
    method: 'get',
    path: ({ s }) => `/students/${s}`,
    gate: 'family-access.assertLinked (includeCoordinated)',
  },
  {
    name: 'guardian detail',
    method: 'get',
    path: ({ g }) => `/guardians/${g}`,
    gate: 'students.controller assertCanSeeGuardian',
  },
  {
    name: 'day register',
    method: 'get',
    path: ({ sec }) => `/attendance/sections/${sec}/register?date=2026-10-20`,
    gate: 'attendance-access.assertCanAccessSection (read)',
  },
  {
    name: 'section attendance summary',
    method: 'get',
    path: ({ sec }) => `/attendance/sections/${sec}/summary?from=2026-10-01&to=2026-10-31`,
    gate: 'attendance-summary.controller assertCanAccessSection',
  },
  {
    name: 'student alerts',
    method: 'get',
    path: ({ s }) => `/attention/students/${s}`,
    gate: 'attention-query.service canSeeStudent',
  },
];

/** Never widened: writes (D4) and the fee / message reads (D5). Same answer before and after. */
export const COORDINATOR_UNCHANGED_ROUTES: ScopeRoute[] = [
  {
    name: 'student notes (read + write path)',
    method: 'get',
    path: ({ s }) => `/students/${s}/notes`,
    gate: 'student-notes.service (teaching rows only)',
  },
  {
    name: 'payments of a student',
    method: 'get',
    path: ({ s }) => `/payments/student/${s}`,
    gate: 'family-access.assertLinked (no flag, D5)',
  },
  {
    name: 'attendance days of a student',
    method: 'get',
    path: ({ s }) => `/attendance/students/${s}/days?month=2026-10`,
    gate: 'family-access.assertLinked (no flag)',
  },
  {
    name: 'mark the day register',
    method: 'put',
    path: ({ sec }) => `/attendance/sections/${sec}/register`,
    gate: 'attendance-access.assertCanAccessSection (write, no flag)',
  },
];
