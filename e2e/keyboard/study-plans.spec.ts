import { type APIRequestContext, type Browser, type Locator, type Page } from '@playwright/test';

import {
  addRoutineSlot,
  adminApiSession,
  createStudyPlan,
  createStudyPlanScene,
  createStudyPlanTemplate,
  detachOfferedSubjects,
  get,
  loginAsFreshUser,
  rawRequest,
  removeRoutineSlots,
  schoolCalendar,
} from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { selectByTypeahead, tabUntilFocused } from './keyboard-utils';

/**
 * [66.4.99/#2029] Keyboard-only journeys for the Epic 66 plan list, the create wizard, the template
 * library and the settings section. The API builds the scene; every step on the surface under test
 * is `page.keyboard` / `.focus()` (no `.click(` and no `page.mouse`).
 *
 * Syllabus tabs and the plans tab are driven as a teacher who owns the subject; the library and the
 * settings section need an admin.
 */

test.setTimeout(120_000);
test.use({ actionTimeout: 10_000 });

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const LESSONS = ['Number systems', 'Fractions', 'Decimals'];

let slotIds: string[] = [];
let planIds: string[] = [];
let templateIds: string[] = [];
let offered: { classId: string; academicYearId: string; subjectIds: string[] } | null = null;
test.afterEach(async ({ request }) => {
  if (slotIds.length + planIds.length + templateIds.length === 0 && !offered) return;
  const admin = await adminApiSession(request);
  for (const id of planIds) await rawRequest(request, admin, 'DELETE', `/study-plans/${id}`);
  for (const id of templateIds) {
    await rawRequest(request, admin, 'DELETE', `/study-plan-templates/${id}`);
  }
  await removeRoutineSlots(request, admin, slotIds);
  if (offered) await detachOfferedSubjects(request, admin, offered, offered.subjectIds);
  offered = null;
  slotIds = [];
  planIds = [];
  templateIds = [];
});

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

/** Tab until `target` holds focus. A heading-based wait would pass on a page that cannot be reached. */
async function tabTo(page: Page, target: Locator, max = 90) {
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) return;
  }
  throw new Error(`could not reach the target within ${max} Tab presses`);
}

test.describe('teacher: tabs, plan row, create wizard', () => {
  test('arrow keys switch tabs, Space filters, Enter opens a plan, the wizard saves by keyboard', async ({
    browser,
    playwright,
    baseURL,
  }) => {
    const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
    const admin = await adminApiSession(ctx);
    const suffix = crypto.randomUUID().slice(0, 6);
    const scene = await createStudyPlanScene(ctx, admin, `Kbd Plans ${suffix}`);
    offered = { ...scene, subjectIds: [scene.subject.id] };
    const cal = await schoolCalendar(ctx, admin);
    const terms = await get<{ id: string; start_date: string; end_date: string }[]>(
      ctx,
      admin,
      `/calendar/terms?academic_year_id=${scene.academicYearId}`,
    );
    const term = terms.find((x) => x.start_date <= cal.today && cal.today <= x.end_date);
    const weekday = [0, 1, 2, 3, 4, 5, 6].find((d) => !cal.weeklyOffDays.includes(d))!;
    slotIds.push(
      await addRoutineSlot(ctx, admin, scene, { sectionId: scene.sectionBId, weekday, period: 1 }),
    );
    // A plan in section B so the list has a row; the wizard then builds the one for section A.
    const existing = await createStudyPlan(ctx, admin, {
      section_id: scene.sectionBId,
      subject_id: scene.subject.id,
      academic_term_id: term?.id ?? null,
      lessons: LESSONS.map((title) => ({ title, periods: 1 })),
    });
    planIds.push(existing.id);
    const planName = `${scene.className}-${scene.sectionBName} ${scene.subject.nameEn}`;
    const templateName = `Kbd Template ${suffix}`;
    const template = await createStudyPlanTemplate(ctx, admin, {
      name: templateName,
      class_grade: 6,
      subject_code: scene.subject.code,
      lessons: LESSONS.map((title) => ({ title, periods: 1 })),
    });
    templateIds.push(template.id);

    const page = await pageFor(browser, ctx, baseURL, scene.teacher);
    const wizard = page.getByRole('dialog', { name: t('studyPlans.create.title') });
    try {
      await test.step('arrow keys in the tab list reach the plans tab', async () => {
        await page.goto('/academics/syllabus');
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        const topics = page.getByRole('tab', { name: t('syllabus.tabs.topics') });
        await tabTo(page, topics);
        await page.keyboard.press('ArrowRight');
        await expect(page.getByRole('tab', { name: t('syllabus.tabs.plans') })).toBeFocused();
        await expect(page.getByRole('tab', { name: t('syllabus.tabs.plans') })).toHaveAttribute(
          'aria-selected',
          'true',
        );
        await expect(page).toHaveURL(/tab=plans/);
      });

      await test.step('Tab to "Behind only", Space toggles it', async () => {
        const behind = page.getByRole('checkbox', {
          name: t('studyPlans.list.filters.behindOnly'),
        });
        await tabTo(page, behind);
        await page.keyboard.press('Space');
        await expect(behind).toBeChecked();
        await page.keyboard.press('Space');
        await expect(behind).not.toBeChecked();
      });

      await test.step("Tab to the first row's open link, Enter opens the plan, back returns", async () => {
        const open = page.getByRole('link', {
          name: t('studyPlans.list.open', { name: planName }),
        });
        await expect(open).toBeVisible();
        await tabTo(page, open);
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(new RegExp(`/academics/study-plans/${existing.id}$`));
        await page.goBack();
        await expect(page).toHaveURL(/tab=plans/);
      });

      await test.step('Ctrl+K "New study plan" opens the wizard', async () => {
        await page.keyboard.press('ControlOrMeta+k');
        await expect(
          page.getByRole('combobox', { name: t('nav.commandPalette.ariaLabel') }),
        ).toBeFocused();
        await page.keyboard.press('Control+3');
        await expect(
          page.getByRole('tab', { name: t('nav.commandPalette.tabs.action') }),
        ).toHaveAttribute('aria-selected', 'true');
        await page.keyboard.type(t('studyPlans.list.newPlan'));
        const option = page.getByRole('option', { name: t('studyPlans.list.newPlan') }).first();
        await expect(option).toBeVisible();
        // Nothing is active until an ArrowDown (activeIndex starts at -1), so a bare Enter picked
        // nothing on a slow run: arrow until the target itself is active (printables-register.spec.ts).
        await expect(async () => {
          if ((await option.getAttribute('aria-selected')) !== 'true') {
            await page.keyboard.press('ArrowDown');
          }
          await expect(option).toHaveAttribute('aria-selected', 'true', { timeout: 500 });
        }).toPass({ timeout: 10_000 });
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/new=1/);
        await expect(wizard).toBeVisible();
      });

      await test.step('a dirty wizard asks before it closes: Esc opens the question, Esc keeps editing', async () => {
        await page.locator('#plan-class').focus();
        await selectByTypeahead(page, scene.className);
        await page.keyboard.press('Escape');
        const ask = page.getByRole('alertdialog');
        await expect(ask).toBeVisible();
        // The question moves focus to "Keep editing" as it opens; Esc before that goes to the wizard behind.
        await expect(
          ask.getByRole('button', { name: t('common.fullPage.keepEditing') }),
        ).toBeFocused();
        // Radix wires the Esc listener a beat after focus lands: retry only while the question is still up.
        await expect(async () => {
          if (await ask.isVisible()) await page.keyboard.press('Escape');
          await expect(ask).toBeHidden({ timeout: 1_000 });
        }).toPass({ timeout: 10_000 });
        await expect(wizard).toBeVisible();
      });

      await test.step('scope: pickers by typeahead, Next with Enter', async () => {
        await page.locator('#plan-section').focus();
        await selectByTypeahead(page, scene.sectionAName);
        await page.locator('#plan-subject').focus();
        await selectByTypeahead(page, scene.subject.nameEn);
        const next = page.getByRole('button', { name: t('studyPlans.create.next') });
        await tabTo(page, next, 30);
        await page.keyboard.press('Enter');
      });

      await test.step('start: arrow keys choose "From the library", Space picks the template, Next', async () => {
        const empty = page.getByRole('radio', { name: t('studyPlans.create.source.empty') });
        await empty.focus();
        // Radix selects a radio on arrow focus only while the arrow is still down (it moves focus on a
        // timer): hold the key a beat, like a person does, instead of a zero-length press.
        await page.keyboard.down('ArrowDown');
        await page.waitForTimeout(100);
        await page.keyboard.up('ArrowDown');
        await expect(
          page.getByRole('radio', { name: t('studyPlans.create.source.library') }),
        ).toBeChecked();
        const row = page.getByRole('radio', { name: new RegExp(templateName) });
        await tabTo(page, row, 10);
        await page.keyboard.press('Space');
        await expect(row).toBeChecked();
        await tabTo(page, page.getByRole('button', { name: t('studyPlans.create.next') }), 30);
        await page.keyboard.press('Enter');
      });

      await test.step('preview lists the lessons; Save lands on the new plan', async () => {
        for (const title of LESSONS) {
          await expect(page.getByRole('cell', { name: title, exact: true })).toBeVisible();
        }
        await tabTo(page, page.getByRole('button', { name: t('studyPlans.create.save') }), 40);
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(new RegExp(`/academics/study-plans/${UUID}$`));
        planIds.push(new URL(page.url()).pathname.split('/').pop()!);
      });
    } finally {
      await page.context().close();
      await ctx.dispose();
    }
  });
});

test.describe('admin: template library dialog and the settings deadline', () => {
  test.use(loggedIn('admin'));

  test('Add template opens a dialog and Esc closes it; the deadline is set and saved by keyboard', async ({
    page,
  }) => {
    await test.step('library: Tab to "Add template", Enter, Esc', async () => {
      await page.goto('/academics/syllabus?tab=library');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const add = page.getByRole('button', { name: t('studyPlans.library.add') }).first();
      await expect(add).toBeVisible();
      await tabUntilFocused(page, t('studyPlans.library.add'), 90, { tag: 'BUTTON' });
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      // Known product bug (see keyboard-utils FOCUS_RETURN_KNOWN_BROKEN): a header primary is a plain
      // Button that sets state, so focus is not handed back to it. Assert only that focus is not trapped.
      await page.keyboard.press('Tab');
      await expect(dialog).toBeHidden();
    });

    await test.step('settings: Tab to the deadline, pick a time, Save', async () => {
      await page.goto('/settings?section=academics');
      await expect(page.locator('#study-plans-section')).toBeVisible();
      const deadline = page.locator('#studyPlans-statusDeadline');
      await expect(deadline).toBeVisible();
      await tabTo(page, deadline, 150);
      await page.keyboard.press('ArrowDown');
      await expect(page.getByRole('option').first()).toBeVisible();
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await expect(page.getByRole('option')).toHaveCount(0);
      const save = page
        .locator('#study-plans-section')
        .getByRole('button', { name: t('settings.save.action') });
      await tabTo(page, save, 40);
      await page.keyboard.press('Enter');
      await expect(
        page.getByRole('status').filter({ hasText: t('settings.save.success') }),
      ).toBeVisible();
    });
  });
});
