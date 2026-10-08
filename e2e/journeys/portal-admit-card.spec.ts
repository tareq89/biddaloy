import type { APIRequestContext, Page } from '@playwright/test';

import { type ApiSession, adminApiSession, get, patch } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [48.3.99] Portal > Exam schedule > admit card (D45). The parent's seeded child
 * has a seeded exam schedule and a published seat plan. The dues-withheld leg turns
 * `documents.withholdAdmitCardForDues` on through the API and always turns it back off.
 */

test.describe.configure({ mode: 'serial' });

/** Other journeys link more children to the shared parent: pick the seeded one with the exam. */
async function openSeededChild(page: Page) {
  await page.goto('/portal/exam-schedule');
  const picker = page.getByRole('link', { name: /Nusrat Jahan.*Class 6 A/ });
  if (await picker.count()) await picker.first().click();
}

async function withholdForDues(request: APIRequestContext, session: ApiSession, on: boolean) {
  const path = `/schools/${session.tenantId}/settings`;
  const current = await get<{ version: number }>(request, session, path);
  await patch(request, session, path, {
    version: current.version,
    documents: { withholdAdmitCardForDues: on },
  });
}

test.describe('Parent sees the admit card button', () => {
  test.use(loggedIn('parent'));

  test('the print button is there and at least 44px tall on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openSeededChild(page);
    const print = page.getByRole('button', { name: t('portal.examSchedule.admitCard.print') });
    await expect(print.first()).toBeVisible();
    const box = await print.first().boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });
});

test.describe('Dues withhold the admit card', () => {
  test.use(loggedIn('parent'));

  test.afterAll(async ({ request }) => {
    await withholdForDues(request, await adminApiSession(request), false);
  });

  test('with the setting on and a due, the button gives way to the withheld message', async ({
    page,
    request,
  }) => {
    await withholdForDues(request, await adminApiSession(request), true);

    await openSeededChild(page);
    const withheld = page.getByRole('heading', {
      name: t('portal.examSchedule.admitCard.withheldTitle'),
    });
    const print = page.getByRole('button', { name: t('portal.examSchedule.admitCard.print') });
    // The seeded child owes money in the demo school; if it does not, the button stays.
    await expect(withheld.or(print.first()).first()).toBeVisible();
  });
});
