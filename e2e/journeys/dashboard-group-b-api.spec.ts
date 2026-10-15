import type { APIRequestContext } from '@playwright/test';

import { adminApiSession, apiSession, get, type ApiSession } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';

/**
 * [8.10.7.3.99] API-level proof of the wave-3 dashboard widget routes against
 * the seed (`server/src/scripts/seed.dashboard.ts`): the teacher's seven, the
 * accountant's seven and the two admin cards return 200 with data, and the
 * roles the catalogue leaves out get 403. Shapes only; the cards themselves land
 * in a later wave. The briefing is `GET /attention/summary` (Epic 67 D1), the
 * same one the shell bar reads.
 */

const widget = <T>(request: APIRequestContext, session: ApiSession, key: string) =>
  get<T>(request, session, `/dashboard/widgets/${key}`);

const status = async (request: APIRequestContext, session: ApiSession, key: string) =>
  (
    await request.get(`/api/v1/dashboard/widgets/${key}`, {
      headers: { Authorization: `Bearer ${session.token}`, 'X-Tenant-ID': session.tenantId },
    })
  ).status();

type Summary = { critical: number; warning: number; reminder: number; activeTotal: number };
const expectSummary = (s: Summary) => {
  for (const k of ['critical', 'warning', 'reminder', 'activeTotal'] as const) {
    expect(typeof s[k], k).toBe('number');
  }
};

test.describe('dashboard widgets API: teacher', () => {
  test.use(loggedIn('teacher'));

  test('routine today and pending sections carry the seeded timetable and registers', async ({
    request,
  }) => {
    const teacher = await apiSession(request, 'teacher');
    const routine = await widget<{
      is_working_day: boolean;
      periods: { starts_at: string; room_label: string | null }[];
      next_day: unknown;
    }>(request, teacher, 'my-routine-today');
    // Friday (the weekly off day) and public holidays carry no periods; any other day has some.
    if (routine.is_working_day) expect(routine.periods.length).toBeGreaterThanOrEqual(1);
    else expect(routine.next_day).not.toBeNull();

    const pending = await widget<{ sections: { section_id: string }[]; pending_count: number }>(
      request,
      teacher,
      'my-pending-sections',
    );
    expect(pending.sections.length).toBeGreaterThanOrEqual(1);
    expect(pending.pending_count).toBeGreaterThanOrEqual(0);
  });

  test('class-teacher-streaks names the homeroom and my-mark-deadlines has a half-entered grid', async ({
    request,
  }) => {
    const teacher = await apiSession(request, 'teacher');
    const streaks = await widget<{
      section: { class_name: string } | null;
      total: number;
      items: unknown[];
    }>(request, teacher, 'class-teacher-streaks');
    expect(streaks.section).not.toBeNull();
    // The streak list itself can be emptied by `attendance.spec.ts`, which marks this
    // section's register for today; the seed's streak shape is pinned in the seed spec.
    expect(streaks.items.length).toBeLessThanOrEqual(streaks.total);

    const deadlines = await widget<{
      outstanding_students: number;
      items: { state: string; entered: number; expected: number }[];
    }>(request, teacher, 'my-mark-deadlines');
    expect(deadlines.items.length).toBeGreaterThanOrEqual(1);
    expect(deadlines.items.some((i) => i.state === 'DRAFT' && i.entered < i.expected)).toBe(true);
    expect(deadlines.outstanding_students).toBeGreaterThanOrEqual(1);
  });

  test('homework-to-check, my-leave-balance and my-syllabus-progress answer with data', async ({
    request,
  }) => {
    const teacher = await apiSession(request, 'teacher');
    const homework = await widget<{ total_submitted: number; items: unknown[] }>(
      request,
      teacher,
      'homework-to-check',
    );
    expect(homework.total_submitted).toBeGreaterThanOrEqual(1);
    expect(homework.items.length).toBeGreaterThanOrEqual(1);

    const leave = await widget<{
      has_profile: boolean;
      by_type: { leave_type: string; annual_quota_days: number | null }[];
    }>(request, teacher, 'my-leave-balance');
    expect(leave.has_profile).toBe(true);
    expect(leave.by_type.find((b) => b.leave_type === 'CASUAL')?.annual_quota_days).toBeGreaterThan(
      0,
    );

    const syllabus = await widget<{ items: { total: number; done: number }[] }>(
      request,
      teacher,
      'my-syllabus-progress',
    );
    expect(syllabus.items.length).toBeGreaterThanOrEqual(1);
    expect(syllabus.items.some((i) => i.total > 0 && i.done > 0)).toBe(true);
  });

  test('the briefing is reachable and the accountant-only dues card is 403', async ({
    request,
  }) => {
    const teacher = await apiSession(request, 'teacher');
    expectSummary(await get<Summary>(request, teacher, '/attention/summary'));
    // The catalogue needs REPORT_COLLECTIONS_READ, which a teacher does not hold.
    expect(await status(request, teacher, 'dues-ageing')).toBe(403);
  });
});

test.describe('dashboard widgets API: admin', () => {
  test.use(loggedIn('admin'));

  test('recent-activity hides the raw change JSON; homework-submission-rate has data', async ({
    request,
  }) => {
    const admin = await adminApiSession(request);
    const activity = await widget<{ items: Record<string, unknown>[] }>(
      request,
      admin,
      'recent-activity',
    );
    expect(activity.items.length).toBeGreaterThanOrEqual(1);
    for (const item of activity.items) {
      expect(item).not.toHaveProperty('old_values');
      expect(item).not.toHaveProperty('new_values');
    }

    const rate = await widget<{ overall: { assigned: number; submitted: number } }>(
      request,
      admin,
      'homework-submission-rate',
    );
    expect(rate.overall.assigned).toBeGreaterThan(0);
    expect(rate.overall.submitted).toBeGreaterThan(0);
  });

  test('the briefing summary answers', async ({ request }) => {
    const admin = await adminApiSession(request);
    expectSummary(await get<Summary>(request, admin, '/attention/summary'));
  });
});

test.describe('dashboard widgets API: accountant', () => {
  test.use(loggedIn('accountant'));

  test('collection-today, collection-by-month and recent-payments carry the seeded payments', async ({
    request,
  }) => {
    const accountant = await apiSession(request, 'accountant');
    const today = await widget<{
      payment_count: number;
      groups: { group: string; net: number }[];
    }>(request, accountant, 'collection-today');
    expect(today.payment_count).toBeGreaterThanOrEqual(3);
    // Cash, bKash and the BANK group (card) each took money; the reversed cash nets to zero.
    for (const group of ['CASH', 'BKASH', 'BANK']) {
      expect(today.groups.find((g) => g.group === group)?.net, group).toBeGreaterThan(0);
    }

    const months = await widget<{ year_to_date_net: number; months: unknown[] }>(
      request,
      accountant,
      'collection-by-month',
    );
    expect(months.months).toHaveLength(12);
    expect(months.year_to_date_net).toBeGreaterThan(0);

    const recent = await widget<{ total_of_shown: number; items: unknown[] }>(
      request,
      accountant,
      'recent-payments',
    );
    expect(recent.items.length).toBeGreaterThanOrEqual(1);
    expect(recent.total_of_shown).toBeGreaterThan(0);
  });

  test('dues-ageing has all three buckets; dues-by-class, reminders-pending and fee-generation-status answer', async ({
    request,
  }) => {
    const accountant = await apiSession(request, 'accountant');
    const ageing = await widget<{ buckets: { bucket: string; amount: number }[] }>(
      request,
      accountant,
      'dues-ageing',
    );
    expect(ageing.buckets.map((b) => b.bucket)).toEqual(['0_30', '31_60', '60_PLUS']);
    for (const b of ageing.buckets) expect(b.amount, b.bucket).toBeGreaterThan(0);

    const byClass = await widget<{ classes: unknown[] }>(request, accountant, 'dues-by-class');
    expect(byClass.classes.length).toBeGreaterThanOrEqual(1);

    // Two flagged bills with no reminder log (a spec that reminds them sends to a student it made).
    const reminders = await widget<{ student_count: number }>(
      request,
      accountant,
      'reminders-pending',
    );
    expect(reminders.student_count).toBeGreaterThanOrEqual(1);

    const generation = await widget<{
      generated: boolean;
      bill_count: number;
      next_scheduled_run: string | null;
    }>(request, accountant, 'fee-generation-status');
    expect(generation.generated).toBe(true);
    expect(generation.bill_count).toBeGreaterThanOrEqual(1);
    expect(generation.next_scheduled_run).not.toBeNull();
  });

  test('the briefing summary answers', async ({ request }) => {
    const accountant = await apiSession(request, 'accountant');
    expectSummary(await get<Summary>(request, accountant, '/attention/summary'));
  });
});

test.describe('dashboard widgets API: committee', () => {
  test.use(loggedIn('committee'));

  test('collection-today, recent-payments and dues-ageing are 403', async ({ request }) => {
    const committee = await apiSession(request, 'committee');
    for (const key of ['collection-today', 'recent-payments', 'dues-ageing']) {
      expect(await status(request, committee, key), key).toBe(403);
    }
  });
});
