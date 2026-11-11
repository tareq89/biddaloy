import type { Page } from '@playwright/test';

import { adminApiSession, createClassSection, post } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { DetailShellPage } from '../pages';

/**
 * [69.4.99] Wave-close proof of "Create next year" on the built app.
 *
 * ```mermaid
 * flowchart LR
 *   A[source year + 1 class] --> B[wizard: name + dates]
 *   B --> C[preview: classes New 1]
 *   C --> D[Create year -> Done step]
 *   D --> E[wizard again: classes Already there 1]
 *   D --> F[set-current dialog warns: 0 teacher assignments]
 * ```
 *
 * The source year is a fresh far-future year this spec alone creates, so the shared seed's
 * current year is never rolled over or made current (the set-current dialog is opened and
 * cancelled, never confirmed). The serial block shares the new year's id between steps.
 */
const YEAR = 2200 + Math.floor(Math.random() * 6000);
const SOURCE_NAME = `E2E Roll ${YEAR}`;
const TARGET_NAME = `E2E Roll ${YEAR + 1}`;

test.use(loggedIn('admin'));

/** The tile of one block on the preview step, found by its checkbox label. */
const tile = (page: Page, block: string) =>
  page.locator('li').filter({ has: page.locator(`#next-year-block-${block}`) });

test.describe.serial('year rollover: wizard, re-run, set-current readiness', () => {
  let sourceId = '';
  let targetId = '';

  test.beforeAll(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    try {
      const session = await adminApiSession(request);
      const bounds = { start_date: `${YEAR}-01-01`, end_date: `${YEAR}-12-31` };
      const year = await post<{ id: string }>(request, session, '/academic-years', {
        name: SOURCE_NAME,
        ...bounds,
      });
      await createClassSection(request, session, { id: year.id, ...bounds });
      sourceId = year.id;
    } finally {
      await request.dispose();
    }
  });

  async function toPreview(page: Page) {
    await page.goto(`/academic-years/${sourceId}/next`);
    await expect(
      page.getByRole('heading', { level: 1, name: t('academicYears.nextYear.title') }),
    ).toBeVisible();
    // Prefilled from the source year: every 4-digit number in the name goes up by one.
    await expect(page.locator('#next-year-name')).toHaveValue(TARGET_NAME);
    await page.getByRole('button', { name: t('academicYears.nextYear.next') }).click();
  }

  test('1. preview counts, Create year, Done step', async ({ page }) => {
    await toPreview(page);
    await expect(tile(page, 'classes')).toContainText(
      t('academicYears.nextYear.tile', { created: 1, existing: 0, skipped: 0 }),
    );

    const [created] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().endsWith(`/academic-years/${sourceId}/next`) && r.request().method() === 'POST',
      ),
      page.getByRole('button', { name: t('academicYears.nextYear.create') }).click(),
    ]);
    expect(created.ok()).toBe(true);
    targetId = ((await created.json()) as { target_year_id: string }).target_year_id;

    await expect(
      page.getByRole('heading', {
        name: t('academicYears.nextYear.done.title', { name: TARGET_NAME }),
      }),
    ).toBeVisible();
    for (const key of ['routines', 'calendar', 'schedules']) {
      await expect(
        page.getByRole('link', { name: t(`academicYears.nextYear.done.${key}`) }),
      ).toBeVisible();
    }
    await expect(
      page.getByRole('button', { name: t('academicYears.nextYear.done.fineRules') }),
    ).toBeVisible();
  });

  test('2. running the wizard again shows the class as already there', async ({ page }) => {
    await toPreview(page);
    await expect(tile(page, 'classes')).toContainText(
      t('academicYears.nextYear.tile', { created: 0, existing: 1, skipped: 0 }),
    );
  });

  test('3. set-current dialog warns, never blocks, at 0 teacher assignments', async ({ page }) => {
    await page.goto(`/academic-years/${targetId}`);
    const detail = new DetailShellPage(page);
    await detail.expectLoaded(TARGET_NAME);
    await detail.clickAction('academicYears.list.setCurrent');

    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByText(t('academicYears.readiness.noTeachers'))).toBeVisible();
    // Warns, never blocks: the confirm button stays usable.
    await expect(
      dialog.getByRole('button', { name: t('academicYears.setCurrentDialog.confirm') }),
    ).toBeEnabled();
    // Cancel: the seeded school's current year must not change under other specs.
    await dialog.getByRole('button', { name: t('common.actions.cancel') }).click();
    await expect(dialog).toBeHidden();
  });
});
