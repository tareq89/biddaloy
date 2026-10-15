import type { APIRequestContext } from '@playwright/test';

import { adminApiSession, apiSession, get, type ApiSession } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';

/**
 * [8.10.7.2.99] API-level proof of the eight wave-2 dashboard widget routes
 * against the seed (`server/src/scripts/seed.dashboard.ts`): the admin gets 200
 * with data, the committee gets 403. Shapes only; the cards are covered by their
 * own component tests. The briefing is `GET /attention/summary` (Epic 67 D1),
 * covered by `attention-*.spec.ts`.
 */

const WIDGET_KEYS = [
  'attendance-today',
  'staff-today',
  'collection-month',
  'mark-entry-progress',
  'syllabus-progress',
  'sms-balance',
  'failed-messages',
  'at-risk-students',
] as const;

const widget = <T>(request: APIRequestContext, session: ApiSession, key: string) =>
  get<T>(request, session, `/dashboard/widgets/${key}`);

test.describe('dashboard widgets API: admin', () => {
  test.use(loggedIn('admin'));

  test('attendance-today and staff-today carry the seeded registers', async ({ request }) => {
    const admin = await adminApiSession(request);
    const attendance = await widget<{
      percentage: number | null;
      is_working_day: boolean;
      pending_sections: unknown[];
      series: { percentage: number | null }[];
    }>(request, admin, 'attendance-today');
    expect(attendance.series).toHaveLength(30);
    // 30 days of finalised registers: more than one point has a value.
    expect(attendance.series.filter((p) => p.percentage !== null).length).toBeGreaterThan(1);
    // The seed leaves 2 registers open today; on the weekly off no register is due at all.
    expect(attendance.pending_sections.length > 0).toBe(attendance.is_working_day);

    const staff = await widget<{ staff_total: number; absent: number; on_leave: unknown[] }>(
      request,
      admin,
      'staff-today',
    );
    expect(staff.staff_total).toBeGreaterThan(0);
    expect(staff.absent).toBeGreaterThanOrEqual(1);
    expect(staff.on_leave.length).toBeGreaterThanOrEqual(1);
  });

  test('collection-month has all three blocks; mark-entry has a deadline', async ({ request }) => {
    const admin = await adminApiSession(request);
    const money = await widget<{
      billed_for_month: number;
      received: number;
      last_month_same_point: { billed_for_month: number };
      last_year_same_point: { billed_for_month: number } | null;
    }>(request, admin, 'collection-month');
    expect(money.billed_for_month).toBeGreaterThan(0);
    expect(money.received).toBeGreaterThan(0);
    expect(money.last_month_same_point.billed_for_month).toBeGreaterThan(0);
    expect(money.last_year_same_point).not.toBeNull();

    const marks = await widget<{
      exam_name: string | null;
      mark_entry_deadline: string | null;
      classes: unknown[];
    }>(request, admin, 'mark-entry-progress');
    expect(marks.exam_name).not.toBeNull();
    expect(marks.mark_entry_deadline).not.toBeNull();
    expect(marks.classes.length).toBeGreaterThan(0);
  });

  test('syllabus, sms-balance and failed-messages answer with data', async ({ request }) => {
    const admin = await adminApiSession(request);
    const syllabus = await widget<{ overall: { total: number } }>(
      request,
      admin,
      'syllabus-progress',
    );
    expect(syllabus.overall.total).toBeGreaterThan(0);
    expect(await widget<{ metering: string }>(request, admin, 'sms-balance')).toHaveProperty(
      'metering',
    );
    const failed = await widget<{ failed: number }>(request, admin, 'failed-messages');
    expect(failed.failed).toBeGreaterThanOrEqual(3);
  });

  test('at-risk-students lists the seeded pair once computed', async ({ request }) => {
    const admin = await adminApiSession(request);
    // The first read enqueues the nightly job; poll until it has stored a list.
    await expect
      .poll(
        async () => (await widget<{ state: string }>(request, admin, 'at-risk-students')).state,
        { timeout: 30_000 },
      )
      .toBe('READY');
    const list = await widget<{ total: number; students: { signals: unknown[] }[] }>(
      request,
      admin,
      'at-risk-students',
    );
    expect(list.total, JSON.stringify(list)).toBeGreaterThanOrEqual(2);
    expect(list.students.every((s) => s.signals.length >= 2)).toBe(true);
  });

  test('the catalogue keys listed here are all reachable', async ({ request }) => {
    const admin = await adminApiSession(request);
    for (const key of WIDGET_KEYS) {
      const response = await request.get(`/api/v1/dashboard/widgets/${key}`, {
        headers: { Authorization: `Bearer ${admin.token}`, 'X-Tenant-ID': admin.tenantId },
      });
      expect(response.status(), key).toBe(200);
    }
  });
});

test.describe('dashboard widgets API: committee', () => {
  test.use(loggedIn('committee'));

  test('every wave-2 widget route is 403', async ({ request }) => {
    const session = await apiSession(request, 'committee');
    for (const key of WIDGET_KEYS) {
      const response = await request.get(`/api/v1/dashboard/widgets/${key}`, {
        headers: { Authorization: `Bearer ${session.token}`, 'X-Tenant-ID': session.tenantId },
      });
      expect(response.status(), key).toBe(403);
    }
  });
});
