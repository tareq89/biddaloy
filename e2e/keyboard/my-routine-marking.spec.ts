import { type Browser, type Locator, type Page } from '@playwright/test';

import {
  addDaysIso,
  addRoutineSlot,
  adminApiSession,
  createStudyPlan,
  createStudyPlanScene,
  detachOfferedSubjects,
  loginAsFreshUser,
  rawRequest,
  removeRoutineSlots,
  schoolCalendar,
  type SchoolCalendar,
} from '../api';
import { expect, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [66.4.99/#2029] Keyboard-only marking on "My routine" (D12), as the teacher of a fresh scene with a
 * plan and three periods on the day under test (browser clock fixed to 10:00 Asia/Dhaka on it):
 * arrow keys in a period's status group, Space, the reason dialog with Enter, "all taught", and the
 * due banner. No `.click(` and no `page.mouse`.
 *
 * Known gap (same as `journeys/study-plan-marking.spec.ts`): the due banner needs a plan older than
 * a day, so its `due` field is filled in on the real response by a route handler; the `?date=` page it
 * leads to runs for real. The server records "all taught" against its own date, so that result is
 * asserted only when the day under test is today; otherwise the button is reached and pressed, nothing more.
 */

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

async function tabTo(page: Page, target: Locator, max = 60) {
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) return;
  }
  throw new Error(`could not reach the target within ${max} Tab presses`);
}

/** An arrow key held for a beat: Radix moves roving focus on a timer and selects only while it is down. */
async function arrow(page: Page, key: 'ArrowRight' | 'ArrowDown' | 'ArrowUp') {
  await page.keyboard.down(key);
  await page.waitForTimeout(100);
  await page.keyboard.up(key);
}

async function teacherPage(
  browser: Browser,
  scene: { teacher: { email: string; password: string } },
  baseURL: string | undefined,
  request: Parameters<typeof loginAsFreshUser>[0],
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

test('keyboard-only: mark a period partly, report one not taught with a reason, mark the rest taught, follow the due banner', async ({
  browser,
  playwright,
  baseURL,
}) => {
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const admin = await adminApiSession(ctx);
  const suffix = crypto.randomUUID().slice(0, 6);
  const scene = await createStudyPlanScene(ctx, admin, `Kbd Mark ${suffix}`);
  offered = { ...scene, subjectIds: [scene.subject.id] };
  const cal = await schoolCalendar(ctx, admin);
  const day = markingDay(cal);
  const yesterday = addDaysIso(day, -1);
  for (const slot of [
    { weekday: weekdayOf(day), period: 1 },
    { weekday: weekdayOf(day), period: 2 },
    { weekday: weekdayOf(day), period: 3 },
    { weekday: weekdayOf(yesterday), period: 1 },
  ]) {
    slotIds.push(await addRoutineSlot(ctx, admin, scene, { sectionId: scene.sectionAId, ...slot }));
  }
  const plan = await createStudyPlan(ctx, admin, {
    section_id: scene.sectionAId,
    subject_id: scene.subject.id,
    academic_term_id: null,
    lessons: [1, 2, 3, 4, 5, 6].map((n) => ({ title: `Kbd marking lesson ${n}`, periods: 1 })),
  });
  planIds.push(plan.id);

  const page = await teacherPage(browser, scene, baseURL, ctx, day);
  let dueOn = true;
  await page.route(/\/api\/v1\/lesson-deliveries\?/, async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as Record<string, unknown>;
    if (dueOn) {
      body.due = { unreported_periods: 1, oldest_date: yesterday, school_days_until_escalation: 2 };
    }
    await route.fulfill({ response, json: body });
  });

  const card = (n: number) =>
    page
      .getByRole('main')
      .getByRole('article')
      .filter({ hasText: t('routines.agenda.periodLabel', { sequence: n }) });
  const radio = (n: number, status: 'taught' | 'partly' | 'notTaught') =>
    card(n).getByRole('radio', { name: t(`routines.marking.status.${status}`) });

  try {
    await page.goto('/routines/my');
    await expect(page.getByRole('main').getByRole('article').first()).toBeVisible({
      timeout: 60_000,
    });

    await test.step('Tab to period 1\'s status group, ArrowRight to "partly", Space', async () => {
      await tabTo(page, radio(1, 'taught'));
      await arrow(page, 'ArrowRight');
      await expect(radio(1, 'partly')).toBeFocused();
      await page.keyboard.press('Space');
      await expect(radio(1, 'partly')).toBeChecked();
      await expect(card(1).getByText(t('routines.marking.badge.reported'))).toBeVisible();
    });

    await test.step('period 2: ArrowRight twice reaches "not taught" and the reason dialog opens', async () => {
      await tabTo(page, radio(2, 'taught'));
      await arrow(page, 'ArrowRight');
      await arrow(page, 'ArrowRight');
      const dialog = page.getByRole('dialog');
      // Arrow focus already picks "not taught", which opens the dialog; Space is the same pick for a
      // user who stopped on it (the radios are hidden from the tree once the dialog is up).
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByRole('heading', { name: t('routines.marking.reason.title') }),
      ).toBeVisible();
    });

    await test.step('the reason dialog: arrows to "Teacher absent", Enter reports, focus returns to the group', async () => {
      const dialog = page.getByRole('dialog');
      const reasons = dialog.getByRole('radio');
      await expect(reasons.first()).toBeFocused();
      await arrow(page, 'ArrowDown');
      await expect(reasons.nth(1)).toBeChecked();
      await arrow(page, 'ArrowUp');
      await expect(
        dialog.getByRole('radio', { name: t('routines.marking.reason.TEACHER_ABSENT') }),
      ).toBeChecked();
      await page.keyboard.press('Enter');
      await expect(dialog).toBeHidden();
      await expect(card(2).getByText(t('routines.marking.badge.reported'))).toBeVisible();
      // D12: focus goes back to the group (its last button), not to <body>.
      await expect(card(2).getByRole('radio').last()).toBeFocused();
    });

    await test.step('Tab to "All of today\'s periods were taught", Enter marks the rest', async () => {
      const bulk = page.getByRole('button', { name: t('routines.marking.allTaught') });
      await expect(bulk).toBeVisible();
      await tabTo(page, bulk);
      const sent = page.waitForResponse(
        (r) => r.request().method() !== 'GET' && r.url().includes('/lesson-deliveries'),
      );
      await page.keyboard.press('Enter');
      await sent;
      if (day === cal.today) {
        await expect(radio(3, 'taught')).toBeChecked();
        await expect(radio(2, 'notTaught')).toBeChecked();
        await expect(radio(1, 'partly')).toBeChecked();
      }
    });

    await test.step("Tab to the due banner's button, Enter opens yesterday", async () => {
      const due = page.getByRole('button', { name: t('routines.marking.due.action') });
      await expect(due).toBeVisible();
      // The banner sits above the cards: Shift+Tab back to it from wherever focus is.
      for (let i = 0; i < 60; i += 1) {
        await page.keyboard.press('Shift+Tab');
        if (await due.evaluate((el) => el === document.activeElement).catch(() => false)) break;
      }
      await expect(due).toBeFocused();
      dueOn = false;
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(new RegExp(`/routines/my\\?date=${yesterday}$`));
    });
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.context().close();
    await ctx.dispose();
  }
});
