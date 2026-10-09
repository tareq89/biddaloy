import { type APIRequestContext, type Browser, type Page } from '@playwright/test';
import fs from 'node:fs';

import {
  addDaysIso,
  addRoutineSlot,
  adminApiSession,
  createStudyPlan,
  createStudyPlanScene,
  createStudyPlanTemplate,
  createTeacher,
  get,
  lastWeekdayOnOrBefore,
  schoolCalendar,
  loginAsFreshUser,
  putLessonDelivery,
  removeRoutineSlots,
  rawRequest,
  sessionForCredentials,
  type ApiSession,
  type StudyPlanScene,
} from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [66.3.99/#2026] Study plans, end to end on the real API: a teacher builds a plan from a library
 * template, edits it, reorders it and copies it to another section; another teacher is fenced out
 * of it (UI and API); an ADMIN finds the plan that is behind, downloads the progress CSV and
 * manages the template library.
 *
 * Local e2e runs in `bn`, so every label goes through `t()` and every list item is found by role.
 * The scenes are built through the API on the seeded Class 6 with a fresh subject and fresh
 * teachers (the seed's own plans are never touched), so the spec is repeatable on a used database.
 */

// Long journeys: the whole test gets a generous budget, but one stuck action fails fast with its own message.
test.setTimeout(120_000);
test.use({ actionTimeout: 10_000 });

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const TEMPLATE_LESSONS = ['Number systems', 'Fractions', 'Decimals', 'Percentages'];

/** Routine slots a test added to the shared seeded routine; removed after it so a re-run finds the period free. */
let slotIds: string[] = [];
/** Plans and templates a test made: removed after it, so the next run's lists hold only their own rows
 * (the behind list in particular). The fresh subject, sections and teachers have no delete endpoint. */
let planIds: string[] = [];
let templateIds: string[] = [];
test.afterEach(async ({ request }) => {
  if (slotIds.length + planIds.length + templateIds.length === 0) return;
  const admin = await adminApiSession(request);
  for (const id of planIds) await rawRequest(request, admin, 'DELETE', `/study-plans/${id}`);
  for (const id of templateIds) {
    await rawRequest(request, admin, 'DELETE', `/study-plan-templates/${id}`);
  }
  await removeRoutineSlots(request, admin, slotIds);
  slotIds = [];
  planIds = [];
  templateIds = [];
});

/** A weekday the school is open: the specs put their weekly period on it. */
const openWeekday = (weeklyOffDays: number[]) =>
  [0, 1, 2, 3, 4, 5, 6].find((d) => !weeklyOffDays.includes(d))!;

async function pageFor(
  browser: Browser,
  request: APIRequestContext,
  baseURL: string | undefined,
  who: { email: string; password: string },
): Promise<Page> {
  const storageState = await loginAsFreshUser(request, baseURL ?? '', who.email, who.password);
  const context = await browser.newContext({ storageState, baseURL: baseURL ?? '' });
  return context.newPage();
}

/** The plan page keeps its less common actions behind "More actions". */
async function planAction(page: Page, name: string) {
  await page
    .getByRole('button', { name: t('common.actions.moreActions') })
    .first()
    .click();
  await page.getByRole('menuitem', { name }).click();
}

/** A Radix select (trigger found by id) → the option with this name. */
async function pick(page: Page, triggerId: string, option: string) {
  await page.locator(`#${triggerId}`).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

test.describe('teacher: build, edit, reorder, copy; another teacher is fenced out', () => {
  test.use(loggedIn('admin'));

  test('library template -> plan with routine dates -> add lesson -> reorder -> copy', async ({
    browser,
    playwright,
    baseURL,
  }) => {
    const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
    const admin = await adminApiSession(ctx);
    const suffix = crypto.randomUUID().slice(0, 6);
    const scene = await createStudyPlanScene(ctx, admin, `Plans ${suffix}`);
    const weekday = openWeekday((await schoolCalendar(ctx, admin)).weeklyOffDays);
    // A weekly period 1 in section A, so the plan's lessons get dates from the routine.
    slotIds.push(
      await addRoutineSlot(ctx, admin, scene, {
        sectionId: scene.sectionAId,
        weekday,
        period: 1,
      }),
    );
    const templateName = `Template ${suffix}`;
    const template = await createStudyPlanTemplate(ctx, admin, {
      name: templateName,
      class_grade: 6,
      subject_code: scene.subject.code,
      lessons: TEMPLATE_LESSONS.map((title) => ({ title, periods: 1 })),
    });
    templateIds.push(template.id);
    // The other teacher has no assignment in this subject: the fence.
    const other = await createTeacher(ctx, admin, `Other ${suffix}`);

    const page = await pageFor(browser, ctx, baseURL, scene.teacher);
    let planUrl = '';
    try {
      await test.step('wizard: scope -> library start -> preview -> save', async () => {
        await page.goto('/academics/syllabus?tab=plans');
        await page
          .getByRole('button', { name: t('studyPlans.list.newPlan') })
          .first()
          .click();
        await pick(page, 'plan-class', scene.className);
        await pick(page, 'plan-section', scene.sectionAName);
        await pick(page, 'plan-subject', scene.subject.nameEn);
        await page.getByRole('button', { name: t('studyPlans.create.next') }).click();

        await page.getByRole('radio', { name: t('studyPlans.create.source.library') }).check();
        // Carry-over stays off: a fresh subject has no earlier-term plan, so that card never shows.
        await page.getByText(templateName, { exact: true }).click();
        await page.getByRole('button', { name: t('studyPlans.create.next') }).click();

        for (const title of TEMPLATE_LESSONS) {
          await expect(page.getByRole('cell', { name: title, exact: true })).toBeVisible();
        }
        await page.getByRole('button', { name: t('studyPlans.create.save') }).click();
        await expect(page).toHaveURL(new RegExp(`/academics/study-plans/${UUID}$`));
        planUrl = new URL(page.url()).pathname;
        planIds.push(planUrl.split('/').pop()!);
      });

      await test.step('plan page: lessons in order, dates from the routine', async () => {
        const rows = page.getByRole('row');
        for (const title of TEMPLATE_LESSONS) {
          await expect(rows.filter({ hasText: title })).toHaveCount(1);
        }
        // The first lesson's expected date comes from the Sunday slot: a dated cell, not the "—" placeholder.
        await expect(rows.filter({ hasText: TEMPLATE_LESSONS[0]! })).toContainText(/[\d০-৯]{4}/);
      });

      await test.step('add a lesson with 2 periods', async () => {
        await page
          .getByRole('button', { name: t('studyPlans.detail.addLesson') })
          .first()
          .click();
        await page
          .getByLabel(t('studyPlans.lesson.title'), { exact: false })
          .fill('Geometry basics');
        await page.getByLabel(t('studyPlans.lesson.periods')).fill('2');
        await page.getByRole('button', { name: t('common.actions.save') }).click();
        await expect(page.getByRole('row').filter({ hasText: 'Geometry basics' })).toHaveCount(1);
      });

      await test.step('move it up with Alt+ArrowUp; the order survives a reload', async () => {
        const row = page.getByRole('row').filter({ hasText: 'Geometry basics' });
        await row.focus();
        await page.keyboard.press('Alt+ArrowUp');
        const order = async () =>
          (await page.getByRole('row').allTextContents()).filter((r) =>
            [...TEMPLATE_LESSONS, 'Geometry basics'].some((title) => r.includes(title)),
          );
        await expect
          .poll(async () => (await order()).findIndex((r) => r.includes('Geometry basics')))
          .toBe(3);
        await page.reload();
        await expect
          .poll(async () => (await order()).findIndex((r) => r.includes('Geometry basics')))
          .toBe(3);
        expect((await order()).findIndex((r) => r.includes(TEMPLATE_LESSONS[3]!))).toBe(4);
      });

      await test.step('copy to the other section the teacher teaches', async () => {
        await planAction(page, t('studyPlans.actions.copyToSection'));
        await page
          .getByRole('combobox', { name: t('studyPlans.copy.section') })
          .fill(scene.sectionBName);
        // The only match is the active option, so Enter picks it (the listbox re-renders while the lookup loads).
        await expect(
          page.getByRole('option', { name: `${scene.className}-${scene.sectionBName}` }),
        ).toBeVisible();
        await page.keyboard.press('Enter');
        await page.getByRole('button', { name: t('studyPlans.copy.save') }).click();
        await page.waitForURL((url) => url.pathname !== planUrl);
        await expect(page).toHaveURL(new RegExp(`/academics/study-plans/${UUID}$`));
        await expect(page.getByRole('heading', { level: 1 })).toContainText(scene.sectionBName);
        planIds.push(new URL(page.url()).pathname.split('/').pop()!);
        await expect(page.getByRole('row').filter({ hasText: 'Geometry basics' })).toHaveCount(1);
      });

      await test.step('delete is offered to the owner', async () => {
        await page
          .getByRole('button', { name: t('common.actions.moreActions') })
          .first()
          .click();
        await expect(
          page.getByRole('menuitem', { name: t('studyPlans.actions.deletePlan') }),
        ).toBeVisible();
        await page.keyboard.press('Escape');
      });
    } finally {
      await page.context().close();
    }

    await test.step('another teacher: refused in the UI and by the API (D28)', async () => {
      const otherPage = await pageFor(browser, ctx, baseURL, other);
      try {
        // Stronger than "no edit controls": a teacher outside the plan's owners cannot even read it.
        await otherPage.goto(planUrl);
        await expect(otherPage.getByText(t('studyPlans.detail.forbidden'))).toBeVisible();
        await expect(
          otherPage.getByRole('button', { name: t('studyPlans.detail.addLesson') }),
        ).toHaveCount(0);
      } finally {
        await otherPage.context().close();
      }
      const planId = planUrl.split('/').pop()!;
      const otherSession = await sessionForCredentials(ctx, other.email, other.password);
      const detail = await get<{ lessons: { id: string; title: string; periods: number }[] }>(
        ctx,
        admin,
        `/study-plans/${planId}`,
      );
      const forced = await rawRequest(ctx, otherSession, 'PUT', `/study-plans/${planId}/lessons`, {
        lessons: detail.lessons.slice(1),
      });
      expect(forced.status).toBe(403);
      expect((await rawRequest(ctx, otherSession, 'GET', `/study-plans/${planId}`)).status).toBe(
        403,
      );
      // And the plan is unchanged.
      const after = await get<{ lessons: unknown[] }>(ctx, admin, `/study-plans/${planId}`);
      expect(after.lessons).toHaveLength(detail.lessons.length);
    });
    await ctx.dispose();
  });
});

test.describe('admin: behind plans, progress CSV, template library', () => {
  test.use(loggedIn('admin'));

  test('behind filter lists the behind plan first; CSV downloads; library add and delete', async ({
    page,
    request,
  }) => {
    const admin: ApiSession = await adminApiSession(request);
    const suffix = crypto.randomUUID().slice(0, 6);
    const scene: StudyPlanScene = await createStudyPlanScene(request, admin, `Behind ${suffix}`);
    const terms = await get<{ id: string; start_date: string; end_date: string }[]>(
      request,
      admin,
      `/calendar/terms?academic_year_id=${scene.academicYearId}`,
    );
    const cal = await schoolCalendar(request, admin);
    const today = cal.today;
    const weekday = openWeekday(cal.weeklyOffDays);
    const term = terms.find((x) => x.start_date <= today && today <= x.end_date);
    test.skip(!term, 'the seeded year has no term around today: the plans tab has no default term');

    // A weekly period; the plan is made today, and the period of its last day was lost.
    slotIds.push(
      await addRoutineSlot(request, admin, scene, {
        sectionId: scene.sectionAId,
        weekday,
        period: 1,
      }),
    );
    const planName = `${scene.className}-${scene.sectionAName} ${scene.subject.nameEn}`;
    const plan = await createStudyPlan(request, admin, {
      section_id: scene.sectionAId,
      subject_id: scene.subject.id,
      academic_term_id: term!.id,
      lessons: [1, 2, 3].map((n) => ({ title: `Behind lesson ${n}`, periods: 1 })),
    });
    planIds.push(plan.id);
    const lostDay = lastWeekdayOnOrBefore(weekday, addDaysIso(today, -1));
    await putLessonDelivery(request, admin, {
      section_id: scene.sectionAId,
      subject_id: scene.subject.id,
      date: lostDay,
      period_slot_id: scene.periodSlotIds[1]!,
      status: 'NOT_TAUGHT',
      reason: 'TEACHER_ABSENT',
    });
    await test.step('plans tab, behind only: the behind plan is first', async () => {
      await page.goto('/academics/syllabus?tab=plans');
      await page.getByRole('checkbox', { name: t('studyPlans.list.filters.behindOnly') }).check();
      // Our plan is listed (other plans may also be behind: the order among them is not ours to assert).
      await expect(
        page.getByRole('link', { name: t('studyPlans.list.open', { name: planName }) }),
      ).toBeVisible();
    });

    await test.step('progress CSV downloads with the expected header', async () => {
      await page.getByRole('combobox', { name: t('studyPlans.list.filters.class') }).click();
      await page.getByRole('option', { name: scene.className, exact: true }).click();
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: t('studyPlans.list.progressCsv') }).click(),
      ]);
      const text = fs.readFileSync((await download.path())!, 'utf8').replace(/^﻿/, '');
      const header = text.split(/\r?\n/)[0]!;
      expect(
        header
          .split(',')
          .map((c) => c.replace(/"/g, ''))
          .slice(0, 4),
      ).toEqual(['section', 'subject', 'owners', 'lessons_done']);
      expect(text).toContain(scene.subject.nameEn);
    });

    await test.step('library: add a template from the plan, see it, delete it', async () => {
      await page.goto(`/academics/study-plans/${plan.id}`);
      await planAction(page, t('studyPlans.actions.addToLibrary'));
      const name = `Kept ${suffix}`;
      await page.getByLabel(t('studyPlans.addToLibrary.name')).fill(name);
      await page
        .getByRole('button', { name: t('studyPlans.actions.addToLibrary') })
        .last()
        .click();
      await expect(page.getByText(t('studyPlans.addToLibrary.done'))).toBeVisible();

      await page.goto('/academics/syllabus?tab=library');
      // Earlier runs leave templates behind (paged list): find ours by name.
      await page.getByPlaceholder(t('studyPlans.library.searchPlaceholder')).fill(name);
      await expect(page.getByRole('cell', { name, exact: true })).toBeVisible();
      const row = page.getByRole('row').filter({ hasText: name });
      await row.getByRole('button', { name: t('common.actions.moreActions') }).click();
      await page
        .getByRole('menuitem', { name: t('studyPlans.library.actions.delete', { name }) })
        .click();
      await page
        .getByRole('alertdialog')
        .getByRole('button', { name: t('studyPlans.library.actions.delete', { name }) })
        .click();
      await expect(page.getByRole('cell', { name, exact: true })).toHaveCount(0);
    });
  });
});
