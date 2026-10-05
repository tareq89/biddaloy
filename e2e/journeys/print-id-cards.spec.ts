import type { Page } from '@playwright/test';

import { adminApiSession, createStudentsInSection, patch, post } from '../api';
import { expect, guest, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [32.4.5] The whole print loop, end to end (D9, D10, D22, D25):
 *
 *   ADMIN (API)   suggestion -> template -> publish -> default, OFFICE printer, 3 students
 *   ACCOUNTANT    students list -> "print the whole section" -> batches of 2
 *                 -> print batch 1 -> 1 card failed -> reprint it -> confirm
 *   ADMIN         history shows copy 2 -> revoke it
 *   anyone        /v/<token> says the revoked copy is REVOKED
 *   phone         /print/preview shows the desktop-only gate
 *
 * The API sets the scene; the UI drives the flow under test. `window.open` is
 * stubbed (a real print window cannot be driven), and the HTML that would have
 * been printed is captured so it can be asserted on.
 */

test.describe.configure({ mode: 'serial' });

const SUFFIX = `${Date.now()}`;
const TEMPLATE_NAME = `E2E Landscape ${SUFFIX}`;
const PRINTER_NAME = `E2E Office A4 ${SUFFIX}`;
const BATCH_SIZE = 2;

interface Scene {
  classId: string;
  sectionId: string;
  className: string;
}
let scene: Scene;
/** The `/v/<token>` path of the copy that gets revoked. */
let revokedVerifyPath: string;

/** Records the HTML that would have been printed, and hands back a fake window. */
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

const printedHtml = (page: Page) =>
  page.evaluate(() => (window as unknown as { __printHtml: string[] }).__printHtml);

test.describe('ADMIN sets the scene', () => {
  test.use(loggedIn('admin'));

  test('template from a suggestion, published and default; an office printer; 3 students', async ({
    request,
  }) => {
    const session = await adminApiSession(request);
    const template = await post<{ id: string }>(request, session, '/print-templates', {
      name: TEMPLATE_NAME,
      suggestion_key: 'student-landscape-modern',
    });
    await patch(request, session, `/print-templates/${template.id}`, { batch_size: BATCH_SIZE });
    await post(request, session, `/print-templates/${template.id}/publish`, {});
    await post(request, session, `/print-templates/${template.id}/default`, {});
    await post(request, session, '/printers', { name: PRINTER_NAME, printer_type: 'OFFICE' });

    const chain = await createStudentsInSection(request, session, `Print E2E ${SUFFIX}`, 3);
    scene = { classId: chain.classId, sectionId: chain.sectionId, className: chain.className };
  });
});

test.describe('ACCOUNTANT prints a whole section', () => {
  test.use(loggedIn('accountant'));

  test('batches of 2, one card fails, it is reprinted as copy 2', async ({ page }) => {
    await stubPrintWindow(page);
    // The reprint's response carries the new copy's `/v/<token>` link (the QR value).
    page.on('response', (res) => {
      if (/\/print-jobs\/[^/]+\/reprint$/.test(res.url()) && res.request().method() === 'POST') {
        void res.json().then((body: { items: Array<{ verify_url: string }> }) => {
          revokedVerifyPath = body.items[0]!.verify_url;
        });
      }
    });
    await page.goto(`/students?class_id=${scene.classId}&section_id=${scene.sectionId}`);

    await test.step('print the whole section from the students list', async () => {
      await page
        .getByRole('button', {
          name: t('students.list.printWholeClass', { name: `${scene.className}-A` }),
        })
        .click();
      await expect(page).toHaveURL(/\/print\/preview/);
      // 3 cards, 2 per batch -> "batch 1 of 2".
      await expect(
        page.getByText(t('printPreview.header.batch', { current: 1, total: 2, count: 2 })),
      ).toBeVisible();
    });

    await test.step('choose the printer and print batch 1', async () => {
      await page.getByRole('combobox', { name: t('printPreview.controls.printer') }).click();
      await page.getByRole('option', { name: new RegExp(PRINTER_NAME) }).click();
      // These students have no photo, so the preview asks for an explicit "print anyway".
      await page.getByRole('checkbox', { name: t('printPreview.preflight.printAnyway') }).check();
      await page.getByRole('button', { name: t('printPreview.print'), exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
    });

    await test.step('the printed page is A4 with no script in it', async () => {
      await expect.poll(async () => (await printedHtml(page)).length).toBeGreaterThan(0);
      const [html] = await printedHtml(page);
      expect(html).toMatch(/@page\s*\{\s*size:\s*210mm 297mm/);
      expect(html).not.toMatch(/<script/i);
    });

    await test.step('one card failed: mark it and reprint it', async () => {
      await page.getByRole('button', { name: t('printPreview.confirm.some') }).click();
      await page.getByRole('checkbox').first().check();
      await page.getByRole('button', { name: t('printPreview.confirm.confirm') }).click();
      await page
        .getByRole('button', { name: t('printPreview.confirm.reprintFailed', { n: 1 }) })
        .click();
      // The reprint opens a second print window, whose page is asked about again.
      await expect.poll(async () => (await printedHtml(page)).length).toBeGreaterThan(1);
      await page.getByRole('button', { name: t('printPreview.confirm.yes') }).click();
    });
  });

  test('on a phone, the preview says to use a computer', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/print/preview?kind=STUDENT_ID_CARD&subject_type=STUDENT');
    await expect(page.getByText(t('printTemplates.gate.title'))).toBeVisible();
  });
});

test.describe('ADMIN reviews the history', () => {
  test.use(loggedIn('admin'));

  test('the reprint is copy 2; revoking it is recorded', async ({ page }) => {
    await page.goto('/reports/printables');
    await expect(page.getByRole('heading', { name: t('printHistory.title') })).toBeVisible();

    // Copy 2 exists for exactly one of this run's students.
    const copy2 = page
      .getByRole('row')
      .filter({ hasText: `Print E2E ${SUFFIX}` })
      .filter({ has: page.getByRole('cell', { name: /^[2২]$/ }) });
    await expect(copy2).toHaveCount(1);

    await copy2.getByRole('button', { name: t('printHistory.actions.revoke') }).click();
    await page.getByLabel(t('printHistory.revoke.reason')).fill('E2E lost card');
    await page.getByRole('button', { name: t('printHistory.revoke.confirm') }).click();
    await expect(copy2.getByRole('cell', { name: t('printHistory.status.REVOKED') })).toBeVisible();
  });
});

test.describe('anyone can verify a card', () => {
  test.use(guest);

  test('the revoked copy says it is revoked', async ({ page }) => {
    expect(revokedVerifyPath).toMatch(/^\/v\//);
    await page.goto(revokedVerifyPath);
    await expect(page.getByText(t('verify.revoked'))).toBeVisible();
  });
});
