/**
 * [Epic 42 / W12] Administration shots: print templates (certificates, ID cards, exam documents).
 */
import { test, type Page } from '@playwright/test';

import { imgDir } from '../helpers/capture';
import { asRole, go, snap, step, tr } from '../helpers/nav';

const dir = imgDir('administration');
const f = (name: string) => `${dir}/${name}.png`;

async function revokeFirst(page: Page, reason: string) {
  const btn = page
    .locator('main tbody tr')
    .first()
    .getByRole('button', { name: /Revoke|বাতিল/ });
  if ((await btn.count()) === 0) return; // already revoked by the other language's run
  await btn.click();
  await page.waitForTimeout(1200);
  const dlg = page.getByRole('dialog');
  await dlg.locator('textarea, input[type="text"]').first().fill(reason);
  await page.waitForTimeout(500);
  await dlg
    .getByRole('button', { name: /Revoke|বাতিল/ })
    .last()
    .click();
  await page.waitForTimeout(2500);
}

test('admin W12: print revoke shots', async ({ browser }, info) => {
  test.skip(info.project.metadata.device !== 'desktop');
  test.setTimeout(900_000);
  const page = await asRole(browser, info, 'admin');
  await page.setViewportSize({ width: 1440, height: 800 });
  await step('certificates-02', async () => {
    await go(page, '/reports/printables?tab=register');
    await page.waitForTimeout(2500);
    await revokeFirst(page, 'Issued with a wrong date of birth');
    await snap(page, f('certificates-02'), []);
  });
  await step('id-cards-02', async () => {
    await go(page, '/reports/printables');
    await page.waitForTimeout(2500);
    await revokeFirst(page, 'Card lost, student reported it');
    await snap(page, f('id-cards-02'), []);
  });
});

async function openStudent(page: Page, row = 0) {
  await go(page, '/students');
  await page.waitForTimeout(2500);
  await page.locator('main tbody tr').nth(row).getByRole('link').first().click();
  await page.waitForTimeout(3000);
}

test('admin W12: certificate and ID card', async ({ browser }, info) => {
  test.skip(info.project.metadata.device !== 'desktop');
  test.setTimeout(900_000);
  const page = await asRole(browser, info, 'admin');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await step('certificates-01', async () => {
    await openStudent(page);
    await page.getByRole('tab', { name: tr('students', 'detail.tabs.documents') }).click();
    await page.waitForTimeout(2000);
    await page.getByRole('button', { name: tr('certificates', 'documentsTab.issue') }).click();
    await page.waitForTimeout(1500);
    const dlg = page.getByRole('dialog');
    await dlg
      .getByText(/^(Testimonial|প্রশংসাপত্র)$/)
      .first()
      .click();
    await page.waitForTimeout(500);
    await dlg.getByRole('button', { name: tr('certificates', 'actions.next') }).click();
    await page.waitForTimeout(2000);
    await dlg
      .getByRole('textbox')
      .first()
      .fill('Good')
      .catch(() => undefined);
    await page.waitForTimeout(500);
    await snap(page, f('certificates-01'), []);
  });
  await step('id-cards-01', async () => {
    await openStudent(page);
    await page
      .getByRole('button', { name: /more|আরও|অন্যান্য/i })
      .first()
      .click();
    await page.waitForTimeout(600);
    await page
      .getByRole('menuitem', { name: /Print ID card|আইডি কার্ড/ })
      .first()
      .click();
    await page.waitForTimeout(4000);
    await page.getByRole('combobox').first().click();
    await page.waitForTimeout(700);
    await page
      .getByRole('option')
      .first()
      .click()
      .catch(() => undefined);
    await page.waitForTimeout(2500);
    await snap(page, f('id-cards-01'), []);
  });
});

test('admin W12: exam documents', async ({ browser }, info) => {
  test.skip(info.project.metadata.device !== 'desktop');
  test.setTimeout(900_000);
  const page = await asRole(browser, info, 'exam-controller');
  await page.setViewportSize({ width: 1440, height: 1500 });
  const openExam = async (row: number) => {
    await go(page, '/exams');
    await page.waitForTimeout(2500);
    await page.locator('main tbody tr').nth(row).getByRole('link').first().click();
    await page.waitForTimeout(3000);
    await page.getByRole('tab', { name: tr('exams', 'detail.tabs.print') }).click();
    await page.waitForTimeout(3000);
  };
  const row = Number(process.env.EXAM_ROW ?? '0');
  await step('exam-documents-01', async () => {
    await openExam(row);
    await snap(page, f('exam-documents-01'), []);
  });
  await step('exam-documents-02', async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page
      .getByRole('button', { name: tr('examDocuments', 'meritCertificate.action') })
      .last()
      .click();
    await page.waitForTimeout(2000);
    const dlg = page.getByRole('dialog');
    await dlg
      .getByLabel(tr('examDocuments', 'merit.topLabel'))
      .fill('3')
      .catch(() => undefined);
    await page.waitForTimeout(5000);
    await snap(page, f('exam-documents-02'), []);
  });
});
