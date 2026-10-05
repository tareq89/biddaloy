import type { Page } from '@playwright/test';

import {
  adminApiSession,
  completeAcr,
  createAcr,
  createClassSection,
  createTeacherForSection,
  currentAcademicYearId,
  get,
  parentApiSession,
  patch,
  post,
} from '../api';
import type { AcrResponse } from '../fixtures/evaluations';
import { acrBody } from '../fixtures/evaluations';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [28.6.4] Epic 28 tail journeys, print + PDF only (D26):
 *  - ACR print: admin opens a COMPLETED ACR, Print leads to the print preview
 *    showing the total and the criteria; an INCOMPLETE ACR has no Print button;
 *  - performance PDF: Print / Save as PDF on the student, class and staff
 *    Performance tabs calls `window.print` (stubbed); a sealed staff survey shows
 *    the waiting line, never a number.
 *
 * OUT OF SCOPE: the committee-role part of #1258 (#1255) is blocked on Epic 24
 * (#786) and is deliberately not covered here.
 *
 * Seed (server/src/scripts/seed.evaluations.ts): the teacher's ACR is COMPLETED,
 * the accounts officer's is INCOMPLETE.
 */

test.describe.configure({ mode: 'serial' });

const SUFFIX = `${Date.now()}`;

/** `window.print` is native UI that cannot be driven: count the calls instead. */
async function stubWindowPrint(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __printCalls: number };
    w.__printCalls = 0;
    window.print = () => {
      w.__printCalls += 1;
    };
  });
}

const printCalls = (page: Page) =>
  page.evaluate(() => (window as unknown as { __printCalls: number }).__printCalls);

async function clickPrintAndExpectCall(page: Page) {
  const before = await printCalls(page);
  await page.getByRole('button', { name: t('performance.print') }).click();
  await expect.poll(() => printCalls(page)).toBe(before + 1);
}

test.describe('ACR print', () => {
  test.use(loggedIn('admin'));

  test('a COMPLETED ACR prints through the preview; an INCOMPLETE one has no Print button', async ({
    page,
    request,
  }) => {
    const session = await adminApiSession(request);
    // The preview needs a default ACR template: one from the built-in suggestion.
    const template = await post<{ id: string }>(request, session, '/print-templates', {
      name: `E2E ACR ${SUFFIX}`,
      suggestion_key: 'acr-a4-standard',
    });
    await patch(request, session, `/print-templates/${template.id}`, { batch_size: 1 });
    await post(request, session, `/print-templates/${template.id}/publish`, {});
    await post(request, session, `/print-templates/${template.id}/default`, {});

    // A fresh COMPLETED ACR: it starts on the CURRENT criteria version, so the
    // expected label can be read from the API. Other specs replace the seeded
    // form's criteria in the shared e2e DB, so "the first seeded criterion" and
    // "the first COMPLETED ACR in the list" are not stable.
    const yearId = await currentAcademicYearId(request, session);
    const chain = await createClassSection(request, session);
    const staff = await createTeacherForSection(
      request,
      session,
      `Tail ACR Staff ${SUFFIX}`,
      chain.sectionId,
    );
    const { criteria } = await get<{
      criteria: { id: string; label_en: string; label_bn: string }[];
    }>(request, session, '/acr/criteria');
    expect(criteria.length).toBeGreaterThan(0);
    const started = await createAcr(request, session, acrBody(staff.userId, yearId));
    await patch(request, session, `/acr/assessments/${started.id}`, {
      scores: criteria.map((c) => ({ criterion_id: c.id, score: 4 })),
    });
    const completed = await completeAcr(request, session, started.id);
    const [incomplete] = await get<AcrResponse[]>(
      request,
      session,
      '/acr/assessments?status=INCOMPLETE',
    );
    expect(incomplete, 'a seeded INCOMPLETE ACR').toBeTruthy();

    await test.step('COMPLETED: Print opens the preview with the total and criteria', async () => {
      await page.goto(`/staff/${completed.user_id}/acr/${completed.id}`);
      await page.getByRole('button', { name: t('evaluations.acr.print') }).click();
      await expect(page).toHaveURL(/\/print\/preview\?/);
      const url = new URL(page.url());
      expect(url.searchParams.get('kind')).toBe('ACR_ASSESSMENT');
      expect(url.searchParams.get('subject_type')).toBe('ACR');
      expect(url.searchParams.get('ids')).toBe(completed.id);

      const sheet = page.getByRole('figure').first();
      await expect(sheet).toBeVisible();
      await expect(sheet).toContainText(String(completed.total));
      // The first criterion of the current form version (printed in either language).
      const escape = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      await expect(sheet).toContainText(
        new RegExp(`${escape(criteria[0]!.label_en)}|${escape(criteria[0]!.label_bn)}`),
      );
    });

    await test.step('INCOMPLETE: no Print button', async () => {
      await page.goto(`/staff/${incomplete!.user_id}/acr/${incomplete!.id}`);
      await expect(page.getByRole('dialog').getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByRole('button', { name: t('evaluations.acr.print') })).toHaveCount(0);
    });
  });
});

test.describe('performance PDF', () => {
  test.use(loggedIn('admin'));

  test('Print / Save as PDF on student, class and staff tabs; sealed survey shows no number', async ({
    page,
    request,
  }) => {
    await stubWindowPrint(page);
    const session = await adminApiSession(request);
    // The seeded parent's child is enrolled in the CURRENT year (see performance-tabs.spec.ts).
    const parent = await parentApiSession(request);
    const [student] = await get<{ id: string }[]>(request, parent, '/students/mine');
    const chain = await createClassSection(request, session);
    const staff = await createTeacherForSection(
      request,
      session,
      `Perf Print ${SUFFIX}`,
      chain.sectionId,
    );

    await test.step('student tab', async () => {
      await page.goto(`/students/${student!.id}?tab=performance`);
      await clickPrintAndExpectCall(page);
    });

    await test.step('class tab', async () => {
      await page.goto(`/classes/${chain.classId}?tab=performance`);
      await clickPrintAndExpectCall(page);
    });

    await test.step('staff tab: sealed survey, no figure', async () => {
      await page.goto(`/staff/${staff.userId}?tab=performance`);
      await expect(page.getByText(t('performance.surveyWaiting')).first()).toBeVisible();
      // A released survey average renders as "<n> / 5".
      await expect(page.locator('#performance-print-area')).not.toContainText(/\/\s*5\b/);
      await clickPrintAndExpectCall(page);
    });
  });
});
