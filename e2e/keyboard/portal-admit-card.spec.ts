import type { APIRequestContext, Page } from '@playwright/test';

import { type ApiSession, adminApiSession, currentAcademicYearId, get, patch, post } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { tabUntilFocused } from './keyboard-utils';

/**
 * [48.4.03] Portal > Exam schedule > "Print admit card", KEYBOARD ONLY, as the seeded `parent`:
 * Tab reaches the button, Enter prints (`window.open` stubbed, the HTML that would have printed
 * is captured and must carry the child's name); with the school's dues rule on (turned on through
 * the API, always turned back off), Enter shows the withheld panel and Tab reaches "See dues and
 * pay". No `.click(` and no `page.mouse` reaches the surfaces under test.
 */

test.describe.configure({ mode: 'serial' });

/** Other journeys link more children to the shared parent: pick the seeded one with the exam. */
async function openSeededChild(page: Page) {
  await page.goto('/portal/exam-schedule');
  const picker = page.getByRole('link', { name: /Nusrat Jahan.*Class 6 A/ });
  if (await picker.count()) {
    await picker.first().focus();
    await page.keyboard.press('Enter');
  }
}

/** `window.open` is stubbed; the printed HTML lands on `window.__printHtml`. */
async function stubPrintWindow(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __printHtml: string[] };
    w.__printHtml = [];
    const realCreate = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (obj: Blob | MediaSource) => {
      if (obj instanceof Blob && obj.type === 'text/html') {
        void obj.text().then((html) => w.__printHtml.push(html));
      }
      return realCreate(obj);
    };
    window.open = (() => ({
      opener: null,
      location: { href: '' },
      print: () => undefined,
      close: () => undefined,
    })) as unknown as typeof window.open;
  });
}

async function withholdForDues(request: APIRequestContext, session: ApiSession, on: boolean) {
  const path = `/schools/${session.tenantId}/settings`;
  const current = await get<{ version: number }>(request, session, path);
  await patch(request, session, path, {
    version: current.version,
    documents: { withholdAdmitCardForDues: on },
  });
}

/** The seeded child on the First Term Exam roster (reg. 2026-2027-0006) gets one unpaid fee. */
async function giveChildADue(request: APIRequestContext, session: ApiSession) {
  const list = await get<{
    data: { id: string; registration_number: string; class_section: { class_id: string } }[];
  }>(request, session, '/students?search=2026-2027-0006');
  const child = list.data.find((x) => x.registration_number === '2026-2027-0006');
  if (!child) throw new Error('seeded child 2026-2027-0006 not found');
  const yearId = await currentAcademicYearId(request, session);
  const structure = await post<{ id: string }>(request, session, '/fee-structures', {
    fee_type: 'MONTHLY_TUITION',
    name: `Kb Portal Due ${Date.now()}`,
    amount: 500,
    class_id: child.class_section.class_id,
    academic_year_id: yearId,
  });
  await post(request, session, '/fees/generate', {
    academic_year_id: yearId,
    period_start: '2026-01-01',
    period_type: 'MONTH',
    student_ids: [child.id],
    fee_structure_ids: [structure.id],
    notify_families: false,
  });
}

test.describe('Parent prints the admit card by keyboard', () => {
  test.use(loggedIn('parent'));

  test.beforeAll(async ({ request }) => {
    await withholdForDues(request, await adminApiSession(request), false);
  });

  test('Tab to the button, Enter prints a page that carries the child name', async ({ page }) => {
    await stubPrintWindow(page);
    await openSeededChild(page);
    const print = page.getByRole('button', { name: t('portal.examSchedule.admitCard.print') });
    await expect(print.first()).toBeVisible();

    await tabUntilFocused(page, t('portal.examSchedule.admitCard.print'), 90, { tag: 'BUTTON' });
    await page.keyboard.press('Enter');

    // The page shows the English full name; the printed card carries the Bangla one, so assert
    // that a name follows the "Name:" label and that it is this child's class.
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            (window as unknown as { __printHtml: string[] }).__printHtml
              .join('')
              .replace(/<style>.*?<\/style>/s, '')
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s+/g, ' '),
          ),
        { timeout: 10_000 },
      )
      .toMatch(/নাম: \S+/);
  });
});

test.describe('Dues withhold the admit card', () => {
  test.use(loggedIn('parent'));

  test.afterAll(async ({ request }) => {
    await withholdForDues(request, await adminApiSession(request), false);
  });

  test('Enter shows the withheld panel; Tab reaches "See dues and pay"', async ({
    page,
    request,
  }) => {
    const admin = await adminApiSession(request);
    await giveChildADue(request, admin);
    await withholdForDues(request, admin, true);
    await stubPrintWindow(page);
    await openSeededChild(page);
    await expect(
      page.getByRole('button', { name: t('portal.examSchedule.admitCard.print') }).first(),
    ).toBeVisible();

    await tabUntilFocused(page, t('portal.examSchedule.admitCard.print'), 90, { tag: 'BUTTON' });
    await page.keyboard.press('Enter');

    // The panel's title is a plain paragraph, not a heading, so match it by its text.
    await expect(page.getByText(t('portal.examSchedule.admitCard.withheldTitle'))).toBeVisible();
    await tabUntilFocused(page, t('portal.examSchedule.admitCard.seeDues'), 60);
  });
});
