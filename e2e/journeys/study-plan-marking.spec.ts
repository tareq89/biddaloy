import { type APIRequestContext, type Browser, type Page } from '@playwright/test';

import {
  addDaysIso,
  addRoutineSlot,
  adminApiSession,
  createOfferedSubject,
  detachOfferedSubjects,
  createStudyPlan,
  createStudyPlanScene,
  get,
  loginAsFreshUser,
  rawRequest,
  schoolCalendar,
  type SchoolCalendar,
  removeRoutineSlots,
  sessionForCredentials,
  type ApiSession,
  type StudyPlanScene,
} from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [66.3.99/#2026] A teacher's "My routine" marking on the real API: report a period taught, report one
 * not taught with a reason, a period with no plan offers no buttons, the due banner leads to the
 * missed day, "all of today's periods were taught" only touches what is left, and a lost period
 * moves the plan's dates (D1).
 *
 * The browser clock is frozen to 10:00 Asia/Dhaka on the day under test; the server still uses the
 * real date. So the day is the latest school day (with a school day before it) on or before today: a
 * weekly-off run marks the last working day, inside the teacher's 7-day window. The two tests that need the SERVER's today (bulk "all
 * taught", the date shift) run only when today itself is a school day, and say so when they skip.
 *
 * Known gap: the due banner needs a plan older than one day (an unreported period before the plan
 * existed is not owed), which a fresh e2e database cannot have. Its `due` field is therefore filled in
 * on the real day response by a route handler; everything it leads to (the `?date=` page, marking,
 * the banner clearing) runs for real.
 */

test.use(loggedIn('admin'));
test.setTimeout(120_000);
test.use({ actionTimeout: 10_000 });

const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
const at10InDhaka = (date: string) => new Date(`${date}T10:00:00+06:00`);

/** Latest day on or before today that is a school day and so is the day before it (for the due banner). */
function markingDay(cal: SchoolCalendar): string {
  let d = cal.today;
  for (let i = 0; i < 14; i++, d = addDaysIso(d, -1)) {
    if (cal.isSchoolDay(d) && cal.isSchoolDay(addDaysIso(d, -1))) return d;
  }
  throw new Error('no two consecutive school days in the last two weeks');
}

let slotIds: string[] = [];
let planIds: string[] = [];
/** Subjects offered to the seeded class by a test (see `detachOfferedSubjects`). */
let offered: { classId: string; academicYearId: string; subjectIds: string[] } | null = null;
test.afterEach(async ({ request }) => {
  if (slotIds.length === 0 && planIds.length === 0 && !offered) return;
  const admin = await adminApiSession(request);
  for (const id of planIds) await rawRequest(request, admin, 'DELETE', `/study-plans/${id}`);
  await removeRoutineSlots(request, admin, slotIds);
  if (offered) await detachOfferedSubjects(request, admin, offered, offered.subjectIds);
  offered = null;
  slotIds = [];
  planIds = [];
});

async function teacherPage(
  browser: Browser,
  request: APIRequestContext,
  baseURL: string | undefined,
  scene: StudyPlanScene,
  day: string,
): Promise<Page> {
  const storageState = await loginAsFreshUser(
    request,
    baseURL ?? '',
    scene.teacher.email,
    scene.teacher.password,
  );
  // No Service Worker: on the built app it answers `/api` fetches itself, so `page.route()` (the
  // injected `due` field) never sees them. Same reason as focus-management.spec.ts.
  const context = await browser.newContext({
    storageState,
    baseURL: baseURL ?? '',
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  await page.clock.setFixedTime(at10InDhaka(day));
  return page;
}

/** The marking card of period `n`. */
const card = (page: Page, n: number) =>
  page
    .getByRole('main')
    .getByRole('article')
    .filter({ hasText: t('routines.agenda.periodLabel', { sequence: n }) });

async function mark(page: Page, n: number, status: 'taught' | 'partly' | 'notTaught') {
  await card(page, n)
    .getByRole('radio', { name: t(`routines.marking.status.${status}`) })
    .click();
}

/** A scene with a six-lesson whole-year plan on the scene's subject, and weekly periods for it. */
async function planWithPeriods(
  request: APIRequestContext,
  admin: ApiSession,
  scene: StudyPlanScene,
  periods: { weekday: number; period: number; subjectId?: string }[],
) {
  for (const p of periods) {
    slotIds.push(
      await addRoutineSlot(request, admin, scene, {
        sectionId: scene.sectionAId,
        weekday: p.weekday,
        period: p.period,
        ...(p.subjectId ? { subjectId: p.subjectId } : {}),
      }),
    );
  }
  const plan = await createStudyPlan(request, admin, {
    section_id: scene.sectionAId,
    subject_id: scene.subject.id,
    academic_term_id: null,
    lessons: [1, 2, 3, 4, 5, 6].map((n) => ({ title: `Marking lesson ${n}`, periods: 1 })),
  });
  planIds.push(plan.id);
  return plan;
}

test('teacher reports taught and not taught, a no-plan period has no buttons, the due banner leads to the missed day', async ({
  browser,
  playwright,
  baseURL,
}) => {
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const admin = await adminApiSession(ctx);
  const suffix = crypto.randomUUID().slice(0, 6);
  const scene = await createStudyPlanScene(ctx, admin, `Mark ${suffix}`);
  const noPlanSubject = await createOfferedSubject(ctx, admin, scene, `Mark ${suffix} Extra`);
  offered = { ...scene, subjectIds: [scene.subject.id, noPlanSubject.id] };
  const cal = await schoolCalendar(ctx, admin);
  const day = markingDay(cal);
  const yesterday = addDaysIso(day, -1);
  const w = weekdayOf(day);
  await planWithPeriods(ctx, admin, scene, [
    { weekday: w, period: 1 },
    { weekday: w, period: 2 },
    { weekday: w, period: 3, subjectId: noPlanSubject.id },
    { weekday: weekdayOf(yesterday), period: 1 },
  ]);

  const page = await teacherPage(browser, ctx, baseURL, scene, day);
  let dueOn = true;
  await page.route(/\/api\/v1\/lesson-deliveries\?/, async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as Record<string, unknown>;
    if (dueOn) {
      body.due = { unreported_periods: 1, oldest_date: yesterday, school_days_until_escalation: 2 };
    }
    await route.fulfill({ response, json: body });
  });
  page.on('response', (response) => {
    const request = response.request();
    if (request.method() === 'PUT' && request.url().includes('/lesson-deliveries')) {
      if ((request.postDataJSON() as { date?: string }).date === yesterday) dueOn = false;
    }
  });

  try {
    await page.goto('/routines/my');
    const main = page.getByRole('main');
    // The page looks up every class's sections first: slow on a database with many classes.
    await expect(main.getByRole('article').first()).toBeVisible({ timeout: 60_000 });

    await test.step('the day card shows the deadline and the counts', async () => {
      // The whole sentence with the time as a wildcard, so it checks the deadline in any locale.
      const deadline = new RegExp(
        t('routines.marking.deadline', { time: '@@' })
          .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          .replace('@@', '\\S+'),
      );
      await expect(main.getByText(deadline)).toBeVisible();
      await expect(
        main.getByText(
          t('routines.marking.counts', { left: 2, reported: 0, cancelled: 0, noPlan: 1 }),
        ),
      ).toBeVisible();
    });

    await test.step('period 1 taught -> Reported', async () => {
      // A period from before the plan existed has no lesson to show (it is not owed): only today does.
      if (day === cal.today) {
        await expect(card(page, 1)).toContainText(
          t('routines.marking.lessonLine', { no: 1, title: 'Marking lesson 1' }),
        );
      } else {
        await expect(card(page, 1)).not.toContainText(t('routines.marking.todaysLesson'));
      }
      await mark(page, 1, 'taught');
      await expect(card(page, 1).getByText(t('routines.marking.badge.reported'))).toBeVisible();
    });

    await test.step('period 2 not taught -> reason dialog -> Teacher absent -> Reported', async () => {
      await mark(page, 2, 'notTaught');
      const dialog = page.getByRole('dialog');
      await expect(
        dialog.getByRole('heading', { name: t('routines.marking.reason.title') }),
      ).toBeVisible();
      await dialog.getByText(t('routines.marking.reason.TEACHER_ABSENT'), { exact: true }).click();
      await dialog.getByRole('button', { name: t('routines.marking.reason.submit') }).click();
      await expect(card(page, 2).getByText(t('routines.marking.badge.reported'))).toBeVisible();
    });

    await test.step('a period with no plan offers the plan link and no buttons (D34, D35)', async () => {
      const noPlan = card(page, 3);
      await expect(noPlan.getByText(t('routines.marking.badge.noPlan'))).toBeVisible();
      await expect(
        noPlan.getByRole('link', { name: t('routines.marking.makePlan') }),
      ).toBeVisible();
      await expect(noPlan.getByRole('radio')).toHaveCount(0);
    });

    await test.step('the due banner opens the missed day; marking there clears it', async () => {
      await page.getByRole('button', { name: t('routines.marking.due.action') }).click();
      await expect(page).toHaveURL(new RegExp(`/routines/my\\?date=${yesterday}$`));
      await mark(page, 1, 'taught');
      await expect(card(page, 1).getByText(t('routines.marking.badge.reported'))).toBeVisible();
      await page.getByRole('button', { name: t('routines.marking.backToToday') }).click();
      await expect(card(page, 1)).toBeVisible();
      await expect(
        page.getByRole('button', { name: t('routines.marking.due.action') }),
      ).toHaveCount(0);
    });

    await test.step('the server agrees (period 2 is a recorded loss, not a taught lesson)', async () => {
      const dayView = await get<{
        periods: { sequence: number; delivery: { status: string; reason: string | null } | null }[];
      }>(
        ctx,
        await sessionForCredentials(ctx, scene.teacher.email, scene.teacher.password),
        `/lesson-deliveries?teacher=me&date=${day}`,
      );
      const by = (n: number) => dayView.periods.find((p) => p.sequence === n)?.delivery;
      expect(by(1)?.status).toBe('TAUGHT');
      expect(by(2)).toMatchObject({ status: 'NOT_TAUGHT', reason: 'TEACHER_ABSENT' });
      expect(by(3)).toBeNull();
    });
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.context().close();
    await ctx.dispose();
  }
});

test.describe('needs today to be a school day (the server records against its own date)', () => {
  test('a lost period moves the next lessons; "all taught" marks only what is left; two parallel writes make one row', async ({
    browser,
    playwright,
    baseURL,
  }) => {
    const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
    const admin = await adminApiSession(ctx);
    const cal = await schoolCalendar(ctx, admin);
    const today = cal.today;
    test.skip(
      !cal.isSchoolDay(today),
      'today is a weekly-off day: the server has no periods to record against its own date',
    );
    const suffix = crypto.randomUUID().slice(0, 6);
    const scene = await createStudyPlanScene(ctx, admin, `Move ${suffix}`);
    const noPlanSubject = await createOfferedSubject(ctx, admin, scene, `Move ${suffix} Extra`);
    offered = { ...scene, subjectIds: [scene.subject.id, noPlanSubject.id] };
    const w = weekdayOf(today);
    // Periods 1-3 of today are the plan's subject, period 5 has no plan; the same slots repeat weekly,
    // so the lessons that do not fit today land on later weeks.
    const plan = await planWithPeriods(ctx, admin, scene, [
      { weekday: w, period: 1 },
      { weekday: w, period: 2 },
      { weekday: w, period: 3 },
      // Period 4 of the seeded shift is lunch.
      { weekday: w, period: 5, subjectId: noPlanSubject.id },
    ]);
    const teacherSession = await sessionForCredentials(
      ctx,
      scene.teacher.email,
      scene.teacher.password,
    );

    const page = await teacherPage(browser, ctx, baseURL, scene, today);
    const lessonDate = async (n: number) => {
      const schedule = await get<{ lessons: { title: string; expected_date: string | null }[] }>(
        ctx,
        teacherSession,
        `/study-plans/${plan.id}/schedule`,
      );
      return schedule.lessons.find((l) => l.title === `Marking lesson ${n}`)?.expected_date;
    };
    try {
      expect(await lessonDate(1)).toBe(today);
      expect(await lessonDate(2)).toBe(today);
      expect(await lessonDate(3)).toBe(today);

      await page.goto('/routines/my');
      await expect(page.getByRole('main').getByRole('article').first()).toBeVisible({
        timeout: 60_000,
      });
      await mark(page, 1, 'taught');
      await expect(card(page, 1).getByText(t('routines.marking.badge.reported'))).toBeVisible();
      await mark(page, 2, 'notTaught');
      const dialog = page.getByRole('dialog');
      await dialog.getByText(t('routines.marking.reason.TEACHER_ABSENT'), { exact: true }).click();
      await dialog.getByRole('button', { name: t('routines.marking.reason.submit') }).click();
      await expect(card(page, 2).getByText(t('routines.marking.badge.reported'))).toBeVisible();

      await test.step('D1: the lost period pushes the lessons after it to a later day', async () => {
        // Before: lessons 1-3 all fit today. Period 2 was lost, so lesson 2 slides into period 3 and
        // lesson 3 no longer fits today.
        expect(await lessonDate(2)).toBe(today);
        const pushed = await lessonDate(3);
        expect(pushed! > today).toBe(true);
        await page.goto(`/academics/study-plans/${plan.id}`);
        // The date column is the fifth cell: lessons 1 and 2 share today's date, lesson 3 has a later one.
        const dateOf = (n: number) =>
          page
            .getByRole('row')
            .filter({ hasText: `Marking lesson ${n}` })
            .getByRole('cell')
            .nth(4);
        // The schedule loads after the lessons: wait for real dates.
        await expect(dateOf(3)).not.toHaveText('—', { timeout: 60_000 });
        const [d1, d2, d3] = [
          await dateOf(1).innerText(),
          await dateOf(2).innerText(),
          await dateOf(3).innerText(),
        ];
        expect(d1).toBe(d2);
        expect(d3).not.toBe(d2);
      });

      await test.step('"All of today\'s periods were taught" marks only the remaining planned period', async () => {
        await page.goto('/routines/my');
        await page.getByRole('button', { name: t('routines.marking.allTaught') }).click();
        await expect(card(page, 3).getByText(t('routines.marking.badge.reported'))).toBeVisible();
        await expect(
          card(page, 2).getByRole('radio', { name: t('routines.marking.status.notTaught') }),
        ).toBeChecked();
        await expect(card(page, 5).getByRole('radio')).toHaveCount(0);
        const dayView = await get<{
          periods: { sequence: number; delivery: { status: string } | null }[];
        }>(ctx, teacherSession, `/lesson-deliveries?teacher=me&date=${today}`);
        const by = (n: number) =>
          dayView.periods.find((p) => p.sequence === n)?.delivery?.status ?? null;
        expect([by(1), by(2), by(3), by(5)]).toEqual(['TAUGHT', 'NOT_TAUGHT', 'TAUGHT', null]);
      });

      await test.step('two writes for the same period at once: one row, last write wins, no 500', async () => {
        const body = (status: 'TAUGHT' | 'PARTLY') => ({
          section_id: scene.sectionAId,
          subject_id: scene.subject.id,
          date: today,
          period_slot_id: scene.periodSlotIds[1]!,
          status,
        });
        const [a, b] = await Promise.all([
          rawRequest(ctx, teacherSession, 'PUT', '/lesson-deliveries', body('TAUGHT')),
          rawRequest(ctx, teacherSession, 'PUT', '/lesson-deliveries', body('PARTLY')),
        ]);
        expect([a.status, b.status].every((s) => s === 200 || s === 201)).toBe(true);
        const dayView = await get<{
          periods: { sequence: number; delivery: { status: string } | null }[];
        }>(ctx, teacherSession, `/lesson-deliveries?teacher=me&date=${today}`);
        expect(dayView.periods.filter((p) => p.sequence === 1)).toHaveLength(1);
        expect(['TAUGHT', 'PARTLY']).toContain(
          dayView.periods.find((p) => p.sequence === 1)?.delivery?.status,
        );
      });
    } finally {
      await page.context().close();
      await ctx.dispose();
    }
  });
});
