import type { Page } from '@playwright/test';

import { adminApiSession, apiSession, get, seededFirstTermExamId } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [48.3.99] One journey per wave-3 screen, on the demo school's seeded data
 * (`ensureDocumentsSeed`, `ensureSeatPlanDemoSeed`), so a fresh `yarn seed` is
 * what is under test:
 *
 *   EXECUTIVE  Printables > Certificate register: seeded serials, a revoked row
 *              with its reason (D39), no "To print" tab (D6)
 *   ADMIN      Printables > To print tab; exam Print tab (three phases);
 *              /print/document?doc=seat-list; the phone gate
 *   OFFICE     student Documents tab: Issue certificate opens the picker (D6)
 *
 * Count-interpolated names (`{{n}}`) are avoided on purpose: the spec helper
 * `t()` cannot resolve plurals, so every assertion uses a plain string.
 */

const SEED_REVOKED_REASON = 'ভুল নাম ছাপা হয়েছে';

interface RegisterRow {
  serial: string | null;
  document_kind: string;
  revoked_at: string | null;
  revoke_reason: string | null;
}

/** Opens the print window and records it; nothing here needs a real one. */
async function stubWindowPrint(page: Page) {
  await page.addInitScript(() => {
    window.print = () => undefined;
  });
}

test.describe('Certificate register', () => {
  test.use(loggedIn('executive'));

  test('lists the seeded serials and a revoked row with its reason', async ({ page, request }) => {
    const session = await apiSession(request, 'executive');
    const register = await get<{ data: RegisterRow[] }>(
      request,
      session,
      '/print-history/register',
    );
    const revoked = register.data.find((r) => r.revoked_at !== null);
    expect(revoked?.revoke_reason).toBe(SEED_REVOKED_REASON);
    expect(register.data.some((r) => r.document_kind === 'TESTIMONIAL' && !r.revoked_at)).toBe(
      true,
    );

    await page.goto('/reports/printables?tab=register');
    await expect(page.getByRole('tab', { name: t('printHistory.tabs.register') })).toBeVisible();
    await expect(page.getByText(SEED_REVOKED_REASON).first()).toBeVisible();
    // D6: an executive reads the register but has no "To print" tab.
    await expect(page.getByRole('tab', { name: t('printHistory.tabs.toPrint') })).toHaveCount(0);
  });
});

test.describe('Printables and exam documents', () => {
  test.use(loggedIn('admin'));

  test('the To print tab is there for ADMIN', async ({ page }) => {
    await page.goto('/reports/printables?tab=to-print');
    await expect(page.getByRole('tab', { name: t('printHistory.tabs.toPrint') })).toBeVisible();
  });

  test('the exam Print tab shows three phases; the seat list opens', async ({ page, request }) => {
    const session = await adminApiSession(request);
    const examId = await seededFirstTermExamId(request, session);

    await page.goto(`/exams/${examId}?tab=print`);
    for (const key of ['before', 'inHall', 'after'] as const) {
      await expect(
        page.getByRole('heading', { name: t(`examDocuments.phase.${key}`) }),
      ).toBeVisible();
    }

    await stubWindowPrint(page);
    await page.goto(`/print/document?doc=seat-list&exam_id=${examId}`);
    await expect(
      page.getByRole('heading', { name: t('examDocuments.seatList.title') }).first(),
    ).toBeVisible();
  });

  test('on a phone, the document page says to use a computer', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/print/document?doc=seat-list');
    await expect(page.getByRole('heading', { name: t('printTemplates.gate.title') })).toBeVisible();
  });
});

test.describe('Student documents', () => {
  test.use(loggedIn('office_staff'));

  test('Issue certificate opens the picker for office staff', async ({ page, request }) => {
    const session = await apiSession(request, 'office_staff');
    const students = await get<{ data: { id: string }[] }>(request, session, '/students?limit=1');
    await page.goto(`/students/${students.data[0]!.id}?tab=documents&issue=pick`);
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(
      page.getByRole('dialog').getByRole('heading', { name: t('certificates.issue.titleNoKind') }),
    ).toBeVisible();
  });
});
