import type { APIRequestContext } from '@playwright/test';

import { adminApiSession, apiSession, get, parentApiSession, type ApiSession } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { SEED_DASHBOARD_GROUP_C } from '../seed-contract';

/**
 * [8.10.7.4.99] API-level proof of the wave-4 Group C routes against the seed
 * (`server/src/scripts/seed.dashboard.ts`): who gets 200 with data, who gets 403, and that a
 * parent reads only a linked child's homework. Shapes and reach only; the cards for these
 * routes are built in wave 5.
 */

const widgetPath = (key: string) => `/dashboard/widgets/${key}`;

const statusOf = async (request: APIRequestContext, session: ApiSession, path: string) =>
  (
    await request.get(`/api/v1${path}`, {
      headers: { Authorization: `Bearer ${session.token}`, 'X-Tenant-ID': session.tenantId },
    })
  ).status();

/** The committee sees aggregates only: no row id and no person or contact field, at any depth. */
const FORBIDDEN_KEYS = new Set([
  'id',
  'full_name',
  'student_name',
  'guardian_name',
  'phone',
  'email',
  'registration_number',
  'roll_number',
]);
function forbiddenKeys(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => forbiddenKeys(v, `${path}[${i}]`));
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([k, v]) => [
    ...(FORBIDDEN_KEYS.has(k) || k.endsWith('_id') ? [`${path}.${k}`] : []),
    ...forbiddenKeys(v, `${path}.${k}`),
  ]);
}

test.describe('Group C API: committee', () => {
  test.use(loggedIn('committee'));

  test('the four committee routes answer 200 with aggregates and no identifying field', async ({
    request,
  }) => {
    const committee = await apiSession(request, 'committee');
    const bodies: Record<string, unknown> = {};
    for (const key of [
      'committee-enrollment',
      'committee-attendance',
      'committee-finance',
      'committee-pass-rate',
    ]) {
      bodies[key] = await get<unknown>(request, committee, widgetPath(key));
      expect(Object.keys(bodies[key] as object).length, key).toBeGreaterThan(0);
      expect(forbiddenKeys(bodies[key]), key).toEqual([]);
    }

    // The seed gives the school five years of roll counts, oldest first, ending at the current one.
    const enrollment = bodies['committee-enrollment'] as {
      years: { year_label: string; student_count: number }[];
      current_count: number;
      previous_count: number | null;
    };
    expect(enrollment.years.length).toBeGreaterThanOrEqual(2);
    expect(enrollment.current_count).toBeGreaterThan(0);
    expect(enrollment.previous_count).not.toBeNull();

    // Two published rounds with a failing student in each class: a real pass rate, below 100.
    const passRate = bodies['committee-pass-rate'] as {
      exam_name: string | null;
      classes: { class_name: string; pass_percentage: number }[];
      overall_pass_percentage: number | null;
    };
    expect(passRate.exam_name).not.toBeNull();
    expect(passRate.classes.length).toBeGreaterThanOrEqual(1);
    expect(passRate.overall_pass_percentage).toBeLessThan(100);

    const finance = bodies['committee-finance'] as { months: unknown[] };
    expect(finance.months.length).toBeGreaterThanOrEqual(1);
  });

  test('the office, exam-controller and money routes are 403', async ({ request }) => {
    const committee = await apiSession(request, 'committee');
    for (const path of [
      widgetPath('results-state'),
      widgetPath('seat-plan-status'),
      widgetPath('admissions-today'),
      widgetPath('guardians-incomplete'),
      widgetPath('students-added-today'),
      '/reports/collections',
    ]) {
      expect(await statusOf(request, committee, path), path).toBe(403);
    }
  });
});

test.describe('Group C API: exam controller', () => {
  test.use(loggedIn('exam_controller'));

  test('results-state counts the rounds and seat-plan-status names the exam still without a plan', async ({
    request,
  }) => {
    const exam = await apiSession(request, 'exam_controller');
    const state = await get<{
      draft: number;
      processed: number;
      published: number;
      rounds: { exam_name: string }[];
    }>(request, exam, widgetPath('results-state'));
    // Two PUBLISHED rounds and one PROCESSED round, over the draft exams the school already has.
    expect(state.published).toBeGreaterThanOrEqual(2);
    expect(state.processed).toBeGreaterThanOrEqual(1);
    expect(state.draft).toBeGreaterThanOrEqual(1);
    expect(state.rounds.length).toBeGreaterThanOrEqual(3);

    const plans = await get<{
      exams_needing_plan: number;
      exams: { exam_name: string; schedule_count: number; planned_count: number }[];
    }>(request, exam, widgetPath('seat-plan-status'));
    expect(plans.exams_needing_plan).toBeGreaterThanOrEqual(1);
    const upcoming = plans.exams.find((e) => e.exam_name === SEED_DASHBOARD_GROUP_C.upcomingExam);
    // Three sittings, a DRAFT seat plan on two of them.
    expect(upcoming?.schedule_count).toBe(3);
    expect(upcoming?.planned_count).toBe(2);
  });
});

test.describe('Group C API: office staff', () => {
  test.use(loggedIn('office_staff'));

  test('admissions-today, guardians-incomplete and students-added-today answer with data', async ({
    request,
  }) => {
    const office = await apiSession(request, 'office_staff');
    const admissions = await get<{ new_today: number; pending_total: number; latest: unknown[] }>(
      request,
      office,
      widgetPath('admissions-today'),
    );
    expect(admissions.new_today).toBeGreaterThanOrEqual(1);
    expect(admissions.pending_total).toBeGreaterThanOrEqual(1);
    expect(admissions.latest.length).toBeGreaterThanOrEqual(1);

    const guardians = await get<{ incomplete_count: number; total_count: number }>(
      request,
      office,
      widgetPath('guardians-incomplete'),
    );
    expect(guardians.incomplete_count).toBeGreaterThanOrEqual(1);
    expect(guardians.total_count).toBeGreaterThanOrEqual(guardians.incomplete_count);

    const added = await get<{ added_today: number; as_of: string }>(
      request,
      office,
      widgetPath('students-added-today'),
    );
    expect(added.added_today).toBeGreaterThanOrEqual(0);
    expect(added.as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

test.describe('Group C API: family homework', () => {
  test.use(loggedIn('admin'));

  test('a parent reads the homework of a linked child and is refused for any other child', async ({
    request,
  }) => {
    const parent = await parentApiSession(request);
    const children = await get<{ id: string }[]>(request, parent, '/students/mine');
    expect(children.length).toBeGreaterThanOrEqual(1);

    // The seed gives the section of parent@'s roll-1 child homework due tomorrow and in five days.
    const lists = await Promise.all(
      children.map((c) =>
        get<{ today: string; items: { title: string; due_date: string }[] }>(
          request,
          parent,
          `/students/${c.id}/homework`,
        ),
      ),
    );
    const titles = lists.flatMap((l) => l.items.map((i) => i.title));
    expect(titles).toContain(SEED_DASHBOARD_GROUP_C.familyHomework);
    for (const list of lists) {
      for (const item of list.items) expect(item.due_date >= list.today).toBe(true);
    }

    // Another family's child: refused, and nothing about them leaks.
    const admin = await adminApiSession(request);
    const everyone = await get<{ data: { id: string }[] }>(request, admin, '/students?limit=100');
    const mine = new Set(children.map((c) => c.id));
    const stranger = everyone.data.find((s) => !mine.has(s.id));
    expect(stranger, 'the seed has students outside parent@ family').toBeDefined();
    const refused = await statusOf(request, parent, `/students/${stranger!.id}/homework`);
    expect([401, 403, 404]).toContain(refused);
  });

  test('an admin has no family view of homework', async ({ request }) => {
    const admin = await adminApiSession(request);
    const [any] = (await get<{ data: { id: string }[] }>(request, admin, '/students?limit=1')).data;
    // `@Roles(PARENT, STUDENT)`: staff use the section views instead.
    expect(await statusOf(request, admin, `/students/${any!.id}/homework`)).toBe(403);
  });
});
