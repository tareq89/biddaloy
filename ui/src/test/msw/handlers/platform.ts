import { http, HttpResponse } from 'msw';

import type {
  Announcement,
  LoginAsSessionItem,
  PlatformAuditItem,
  PlatformUserItem,
} from '../../../hooks/platform-console';
import type { PlatformSchoolSearchItem } from '../../../hooks/platform-school-control';

/**
 * Cockpit routes added by Epic 99 (Login as, school control, console). Fake data only: names are
 * invented, emails use `.test`, phones are the 0170000000x range reserved here for fixtures.
 * One school per consent state and one person per greyed reason, so a story shows every state.
 */
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const SCHOOL_ALLOWED = ID(101);
export const SCHOOL_ASK = ID(102);
export const SCHOOL_BLOCKED = ID(103);
export const SCHOOL_NO_ADMIN = ID(104);

type Mode = 'allowed' | 'ask' | 'blocked';
const school = (id: string, name: string, mode: Mode, noActiveAdmin = false) => ({
  id,
  name,
  mode,
  noActiveAdmin,
});
export const loginAsSchoolFixtures = [
  school(SCHOOL_ALLOWED, 'Rose Valley School', 'allowed'),
  school(SCHOOL_ASK, 'Green Hill School', 'ask'),
  school(SCHOOL_BLOCKED, 'Blue River School', 'blocked'),
  school(SCHOOL_NO_ADMIN, 'Quiet Lake School', 'allowed', true),
];

export const platformSchoolFixture = (
  s: ReturnType<typeof school>,
  overrides: Partial<PlatformSchoolSearchItem> = {},
): PlatformSchoolSearchItem => ({
  id: s.id,
  name: s.name,
  slug: s.name.toLowerCase().replace(/\s+/g, '-'),
  status: 'ACTIVE',
  statusReason: null,
  createdAt: '2029-01-01T00:00:00.000Z',
  studentCount: 120,
  lastActivityAt: '2029-12-30T00:00:00.000Z',
  trialEndsAt: null,
  seatLimit: null,
  deletedAt: null,
  ...overrides,
});

/** One person per greyed reason, plus one who can be chosen. */
export const loginAsCandidateFixtures = [
  {
    userId: ID(201),
    name: 'Anika Rahman',
    role: 'TEACHER',
    email: 'anika@example.test',
    phone: '01700000001',
    unavailableReason: null,
  },
  {
    userId: null,
    name: 'Rafi Hasan',
    role: 'STUDENT',
    email: null,
    phone: null,
    unavailableReason: 'NO_LOGIN_ACCOUNT',
  },
  {
    userId: ID(203),
    name: 'Tania Akter',
    role: 'ACCOUNTANT',
    email: 'tania@example.test',
    phone: '01700000003',
    unavailableReason: 'INACTIVE',
  },
];

export const loginAsSessionFixture = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id: ID(301),
  schoolId: SCHOOL_ALLOWED,
  schoolName: 'Rose Valley School',
  platformAdminId: ID(1),
  platformAdminName: 'Owner One',
  userId: ID(201),
  userName: 'Anika Rahman',
  role: 'TEACHER',
  status: 'ACTIVE',
  kind: 'NORMAL',
  viewOnly: true,
  reason: 'Parent could not see the timetable',
  requestedAt: '2029-12-31T00:00:00.000Z',
  startedAt: '2029-12-31T00:00:01.000Z',
  endedAt: null,
  endedBy: null,
  expiresAt: '2030-01-01T00:00:00.000Z',
  ...overrides,
});

const userFixture: PlatformUserItem = {
  userId: ID(201),
  fullName: 'Anika Rahman',
  emailMasked: 'a***@example.test',
  phoneMasked: '017****001',
  status: 'ACTIVE',
  locked: false,
  lastLoginAt: '2029-12-30T00:00:00.000Z',
  memberships: [
    {
      memberId: ID(401),
      schoolId: SCHOOL_ALLOWED,
      schoolName: 'Rose Valley School',
      role: 'TEACHER',
    },
  ],
};

const auditFixture: PlatformAuditItem = {
  id: ID(501),
  action: 'IMPERSONATION_STARTED',
  entityType: 'ImpersonationSession',
  schoolName: 'Rose Valley School',
  tenantId: SCHOOL_ALLOWED,
  actorName: 'Owner One',
  impersonatedByName: null,
  sessionId: ID(301),
  at: '2029-12-31T00:00:00.000Z',
};

const sessionRow: LoginAsSessionItem = {
  id: ID(301),
  ownerId: ID(1),
  ownerName: 'Owner One',
  schoolId: SCHOOL_ALLOWED,
  schoolName: 'Rose Valley School',
  role: 'TEACHER',
  personName: 'Anika Rahman',
  reason: 'Parent could not see the timetable',
  entryKind: 'NORMAL',
  startedAt: '2029-12-31T00:00:01.000Z',
  endedAt: null,
  status: 'ACTIVE',
  changedCount: 0,
};

const announcementFixture: Announcement = {
  id: ID(601),
  title: 'Planned maintenance',
  severity: 'REMINDER',
  statusFilter: ['ACTIVE'],
  sms: false,
  email: true,
  schoolsTargeted: 4,
  schoolsSucceeded: 4,
  recipientCount: 6,
  createdByName: 'Owner One',
  createdAt: '2029-12-31T00:00:00.000Z',
};

const noContent = () => new HttpResponse(null, { status: 204 });

/** Sessions ended through the mock DELETE; the live list leaves them out. Reset after each test. */
const endedSessionIds = new Set<string>();
export function resetPlatformStore(): void {
  endedSessionIds.clear();
}

export const platformDefaultHandlers = [
  // Login as
  http.get('*/platform/schools/:id/login-as/candidates', ({ params }) => {
    const s = loginAsSchoolFixtures.find((x) => x.id === params.id) ?? loginAsSchoolFixtures[0]!;
    return HttpResponse.json({
      candidates: s.noActiveAdmin ? [] : loginAsCandidateFixtures,
      noActiveAdmin: s.noActiveAdmin,
      schoolStatus: 'ACTIVE',
      supportAccessMode: s.mode,
    });
  }),
  http.get('*/platform/impersonation', () =>
    HttpResponse.json([loginAsSessionFixture()].filter((x) => !endedSessionIds.has(String(x.id)))),
  ),
  http.post('*/platform/impersonation', async ({ request }) => {
    const body = (await request.json()) as { schoolId: string };
    const s = loginAsSchoolFixtures.find((x) => x.id === body.schoolId);
    // ask mode waits for the school admin: no code yet.
    if (s?.mode === 'ask') return HttpResponse.json({ id: ID(302), status: 'REQUESTED' });
    return HttpResponse.json({
      id: ID(301),
      status: 'ACTIVE',
      code: 'one-time-code',
      expiresAt: '2030-01-01T00:00:00.000Z',
    });
  }),
  http.post('*/platform/impersonation/:id/request-write', noContent),
  http.delete('*/platform/impersonation/:id', ({ params }) => {
    endedSessionIds.add(String(params.id));
    return new HttpResponse(null, { status: 204 });
  }),

  // School control
  http.get('*/platform/schools/search', () =>
    HttpResponse.json({
      items: loginAsSchoolFixtures.map((s) => platformSchoolFixture(s)),
      total: loginAsSchoolFixtures.length,
    }),
  ),
  http.get('*/platform/schools/:id/overview', ({ params }) =>
    HttpResponse.json({
      schoolId: params.id,
      admins: [
        {
          userId: ID(202),
          name: 'Nabil Karim',
          email: 'nabil@example.test',
          phone: '01700000002',
          membershipStatus: 'ACTIVE',
        },
      ],
      peopleByRole: [{ role: 'TEACHER', count: 12 }],
      smsBalance: { available: 100, reserved: 0 },
      filesBytes: 1024,
      openAlerts: [],
      recentAudit: [],
      lastActivityAt: '2029-12-30T00:00:00.000Z',
      notesCount: 1,
    }),
  ),
  http.get('*/platform/schools/:id/notes', () =>
    HttpResponse.json([
      {
        id: ID(701),
        authorId: ID(1),
        text: 'Asked for a longer trial',
        createdAt: '2029-12-30T00:00:00.000Z',
      },
    ]),
  ),
  http.post('*/platform/schools/:id/notes', async ({ request }) => {
    const { text } = (await request.json()) as { text: string };
    return HttpResponse.json(
      { id: ID(702), authorId: ID(1), text, createdAt: '2029-12-31T00:00:00.000Z' },
      { status: 201 },
    );
  }),
  http.delete('*/platform/schools/:id/notes/:noteId', noContent),
  http.post('*/platform/schools/:id/logout-all', () =>
    HttpResponse.json({ usersSignedOut: 14 }, { status: 201 }),
  ),
  http.post('*/platform/schools/:id/admins/:userId/reset-link', () =>
    HttpResponse.json({ channel: 'EMAIL', expiresAt: '2030-01-01T00:00:00.000Z' }, { status: 201 }),
  ),
  http.patch('*/platform/schools/:id/name', async ({ request }) => {
    const b = (await request.json()) as { name?: string; name_bn?: string | null };
    return HttpResponse.json({
      name: b.name ?? 'Rose Valley School',
      name_bn: b.name_bn ?? null,
      changed: true,
    });
  }),
  http.post('*/platform/schools/:id/archive/export', () =>
    HttpResponse.json({ jobId: ID(801) }, { status: 201 }),
  ),
  http.get('*/platform/schools/:id/archive/export/:jobId', ({ params }) =>
    HttpResponse.json({
      id: params.jobId,
      status: 'DONE',
      sizeBytes: '2048',
      pinned: false,
      error: null,
      expiresAt: '2030-01-01T00:00:00.000Z',
      finishedAt: '2029-12-31T00:00:00.000Z',
    }),
  ),
  http.post('*/platform/schools/:id/archive', ({ params }) =>
    HttpResponse.json(
      { id: params.id, status: 'SUSPENDED', exportJobId: ID(801) },
      { status: 201 },
    ),
  ),

  // Console
  http.get('*/platform/users', () => HttpResponse.json([userFixture])),
  http.post('*/platform/users/:id/logout', noContent),
  http.get('*/platform/audit/sessions', () =>
    HttpResponse.json({ items: [sessionRow], nextCursor: null }),
  ),
  http.get('*/platform/audit', () =>
    HttpResponse.json({ items: [auditFixture], nextCursor: null }),
  ),
  http.get('*/platform/ops/queues', () =>
    HttpResponse.json({
      queues: [
        { name: 'sms', available: true, waiting: 0, active: 0, failed: 2, delayed: 0 },
        { name: 'email', available: false },
      ],
    }),
  ),
  http.post('*/platform/ops/queues/:name/retry-failed', () =>
    HttpResponse.json({ retried: 2 }, { status: 201 }),
  ),
  http.get('*/platform/ops/system', () =>
    HttpResponse.json({
      appVersion: '1.0.0-test',
      lastMigration: '1790000000000-Test',
      database: 'ok',
      redis: 'ok',
      restoring: [
        {
          schoolId: SCHOOL_ASK,
          schoolName: 'Green Hill School',
          jobStatus: 'RUNNING',
          locked: true,
        },
      ],
    }),
  ),
  http.post('*/platform/ops/restore-lock/:schoolId/release', () =>
    HttpResponse.json({ released: true, failedJobs: 0 }, { status: 201 }),
  ),
  http.get('*/platform/announcements', () =>
    HttpResponse.json({ items: [announcementFixture], total: 1 }),
  ),
  http.post('*/platform/announcements/preview', () =>
    HttpResponse.json({ schools: 4, people: 6 }, { status: 201 }),
  ),
  http.post('*/platform/announcements', () =>
    HttpResponse.json(announcementFixture, { status: 201 }),
  ),
];
