import { type Locator, type Page } from '@playwright/test';

import {
  adminApiSession,
  createStudyPlan,
  createStudyPlanScene,
  detachOfferedSubjects,
  loginAsFreshUser,
  post,
  rawRequest,
} from '../api';
import { expect, test } from '../fixtures/test';
import { t } from '../i18n';
import { selectByTypeahead } from './keyboard-utils';

/**
 * [66.4.99/#2029] Keyboard-only journey on the study-plan page (`/academics/study-plans/$planId`), as the
 * teacher who owns the subject: move a lesson with Alt+Arrow and hear it announced, add a lesson in a
 * dialog, and set an exam syllabus marker from the More menu. The API builds the scene; no `.click(`
 * and no `page.mouse` on the surface under test.
 */

test.setTimeout(120_000);
test.use({ actionTimeout: 10_000 });

const LESSONS = ['Number systems', 'Fractions', 'Decimals', 'Percentages'];

let planIds: string[] = [];
let offered: { classId: string; academicYearId: string; subjectIds: string[] } | null = null;
test.afterEach(async ({ request }) => {
  if (planIds.length === 0 && !offered) return;
  const admin = await adminApiSession(request);
  for (const id of planIds) await rawRequest(request, admin, 'DELETE', `/study-plans/${id}`);
  if (offered) await detachOfferedSubjects(request, admin, offered, offered.subjectIds);
  offered = null;
  planIds = [];
});

async function tabTo(page: Page, target: Locator, max = 90) {
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) return;
  }
  throw new Error(`could not reach the target within ${max} Tab presses`);
}

test('keyboard-only: move a lesson, add a lesson, set an exam marker', async ({
  browser,
  playwright,
  baseURL,
}) => {
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const admin = await adminApiSession(ctx);
  const suffix = crypto.randomUUID().slice(0, 6);
  const scene = await createStudyPlanScene(ctx, admin, `Kbd Detail ${suffix}`);
  offered = { ...scene, subjectIds: [scene.subject.id] };
  const plan = await createStudyPlan(ctx, admin, {
    section_id: scene.sectionAId,
    subject_id: scene.subject.id,
    academic_term_id: null,
    lessons: LESSONS.map((title) => ({ title, periods: 1 })),
  });
  planIds.push(plan.id);
  const examName = `Kbd Exam ${suffix}`;
  await post(ctx, admin, '/exams', {
    name: examName,
    kind: 'TERM',
    academic_year_id: scene.academicYearId,
    class_id: scene.classId,
  });

  const storageState = await loginAsFreshUser(
    ctx,
    baseURL ?? '',
    scene.teacher.email,
    scene.teacher.password,
  );
  const context = await browser.newContext({ storageState, baseURL: baseURL ?? '' });
  const page = await context.newPage();
  const rows = page.getByRole('row');
  const order = async () =>
    (await rows.allTextContents()).filter((r) =>
      LESSONS.concat('Geometry').some((l) => r.includes(l)),
    );
  try {
    await page.goto(`/academics/study-plans/${plan.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await test.step('Tab to a lesson row, Alt+ArrowDown moves it; the live region says so and the order survives a reload', async () => {
      const first = rows.filter({ hasText: LESSONS[0]! });
      await expect(first).toBeVisible();
      await tabTo(page, first, 150);
      // The move is optimistic: reloading before its PUT lands would read back the old order.
      const saved = page.waitForResponse(
        (r) =>
          r.request().method() === 'PUT' && r.url().endsWith(`/study-plans/${plan.id}/lessons`),
      );
      await page.keyboard.press('Alt+ArrowDown');
      await expect(
        page.locator('[aria-live="polite"]').filter({
          hasText: new RegExp(`${LESSONS[0]}`),
        }),
      ).toHaveCount(1);
      await expect.poll(async () => (await order())[1]).toContain(LESSONS[0]!);
      // Focus follows the moved row, so the next move can follow at once.
      await expect(first).toBeFocused();
      expect((await saved).ok()).toBe(true);
      await page.reload();
      await expect(first).toBeVisible();
      await expect.poll(async () => (await order())[1]).toContain(LESSONS[0]!);
    });

    await test.step('Tab to "Add lesson", Enter opens the dialog, type a title, Enter saves', async () => {
      const add = page.getByRole('button', { name: t('studyPlans.detail.addLesson') }).first();
      await tabTo(page, add, 150);
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: t('studyPlans.lesson.addTitle') });
      await expect(dialog).toBeVisible();
      await page.getByLabel(t('studyPlans.lesson.title'), { exact: false }).focus();
      await page.keyboard.type('Geometry');
      await page.keyboard.press('Enter');
      await expect(dialog).toBeHidden();
      await expect(rows.filter({ hasText: 'Geometry' })).toHaveCount(1);
    });

    await test.step('More actions opens with Enter; arrow keys reach "Set exam syllabus marker"', async () => {
      const more = page.getByRole('button', { name: t('common.actions.moreActions') }).first();
      await tabTo(page, more, 150);
      await page.keyboard.press('Enter');
      const item = page.getByRole('menuitem', { name: t('studyPlans.actions.examMarker') });
      await expect(item).toBeVisible();
      for (
        let i = 0;
        i < 10 && !(await item.evaluate((el) => el === document.activeElement));
        i += 1
      ) {
        await page.keyboard.press('ArrowDown');
      }
      await expect(item).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('dialog', { name: t('studyPlans.markers.title') })).toBeVisible();
    });

    await test.step('pick the exam by typeahead and the lesson with arrows, add the marker, Save', async () => {
      await page.locator('#marker-exam').focus();
      await selectByTypeahead(page, examName);
      await page.locator('#marker-lesson').focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('option').first()).toBeVisible();
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await expect(page.getByRole('listbox')).toBeHidden();
      const addMarker = page.getByRole('button', { name: t('studyPlans.markers.add') });
      await tabTo(page, addMarker, 5);
      await page.keyboard.press('Enter');
      await expect(
        page.getByRole('dialog').getByRole('listitem').filter({ hasText: examName }),
      ).toBeVisible();
      await tabTo(page, page.getByRole('button', { name: t('common.actions.save') }), 10);
      await page.keyboard.press('Enter');
      await expect(page.getByRole('dialog')).toBeHidden();
      await expect(page.getByText(t('studyPlans.detail.marker', { exam: examName }))).toBeVisible();
    });
  } finally {
    await context.close();
    await ctx.dispose();
  }
});
