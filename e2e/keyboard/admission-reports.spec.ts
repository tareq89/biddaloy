import { adminApiSession, createClassSection, post } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

import { selectByTypeahead, tabUntilFocused } from './keyboard-utils';

/**
 * [39.4.3] Keyboard-only journey for the People › Admissions › Admission reports screen:
 * Tab to its sidebar link, open it, pick an academic year in the filter, and read the counts
 * and the event table.
 *
 * The data is built here through the API, in a brand-new academic year (`createClassSection`
 * makes a uniquely named year, class and section per call), so the counts are exact and no
 * other spec can change them. The seeded demo events are deliberately NOT used: the student
 * lifecycle keyboard spec leaves and readmits seeded student 0001 in the same database, which
 * would move Left and Readmitted under this test.
 *
 * Events recorded, all in that new year:
 *   A: WITHDRAWN, then READMITTED     B: TRANSFERRED_OUT     C: GRADUATED
 * so the tiles read Left 2 (A's withdrawal + B), Graduated 1, Readmitted 1.
 * A second fresh year has no events, so it must show the empty state.
 *
 * Reaching the sidebar link by Tab is the point of this spec (nav reachability), so it tabs
 * through the sidebar. The cap is generous on purpose: the press count grows with every nav
 * item, and a tight cap turns each new sidebar link into a failure somewhere else
 * (class-teachers.spec hit exactly that).
 */

test.use(loggedIn('admin'));

const TABS_TO_NAV_LINK_MAX = 150;
const DESTINATION = 'Dhaka Residential Model College';

/** `createClassSection` names its year `E2E Year <suffix>` and its class `E2E <suffix>`. */
const yearNameFor = (className: string) => `E2E Year ${className.slice('E2E '.length)}`;

test('keyboard-only: open the admission report, pick a year, read the lifecycle counts', async ({
  page,
  request,
}) => {
  const session = await adminApiSession(request);
  const stamp = Date.now();

  // --- isolated data: one fresh year with known events, one fresh year with none -----------
  const chain = await createClassSection(request, session);
  const emptyChain = await createClassSection(request, session);
  const makeStudent = async (label: string) => {
    const full_name = `E2E Report ${label} ${stamp}`;
    const student = await post<{ id: string }>(request, session, '/students', {
      full_name,
      class_section_id: chain.sectionId,
    });
    return { id: student.id, full_name };
  };
  const a = await makeStudent('A');
  const b = await makeStudent('B');
  const c = await makeStudent('C');

  // `occurred_on` is required by the API (only the dialogs default it); any past date works.
  await post(request, session, `/students/${a.id}/leave`, {
    type: 'WITHDRAWN',
    occurred_on: '2026-03-01',
    reason: 'e2e withdrawn',
  });
  await post(request, session, `/students/${a.id}/readmit`, {
    occurred_on: '2026-04-01',
    class_section_id: chain.sectionId,
    reason: 'e2e readmitted',
  });
  await post(request, session, `/students/${b.id}/leave`, {
    type: 'TRANSFERRED_OUT',
    occurred_on: '2026-03-02',
    reason: 'e2e transferred',
    destination: DESTINATION,
  });
  await post(request, session, `/students/${c.id}/leave`, {
    type: 'GRADUATED',
    occurred_on: '2026-03-03',
    reason: 'e2e graduated',
  });

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

  await test.step('nav -> Admission reports, keyboard only', async () => {
    await page.evaluate(() => {
      document.body.setAttribute('tabindex', '-1');
      document.body.focus();
      document.body.removeAttribute('tabindex');
    });
    await page.keyboard.press('Tab');
    await tabUntilFocused(page, t('nav.items.admissionReports'), TABS_TO_NAV_LINK_MAX, {
      tag: 'a',
    });
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('heading', { level: 1, name: t('admission-reports.title') }),
    ).toBeVisible();
  });

  const counts = page.getByTestId('lifecycle-counts');
  const tile = (label: string) =>
    counts.locator('div', { has: page.getByText(label, { exact: true }) });
  const yearSelect = () => page.getByRole('combobox', { name: t('admission-reports.filterYear') });

  await test.step('pick the new year by keyboard and read the counts and rows', async () => {
    await yearSelect().focus();
    await selectByTypeahead(page, yearNameFor(chain.className));

    await expect(counts).toBeVisible();
    // Counts print in the tenant's numerals (Latin or Bangla digits).
    await expect(tile(t('admission-reports.countLeft'))).toContainText(/[2২]/);
    await expect(tile(t('admission-reports.countGraduated'))).toContainText(/[1১]/);
    await expect(tile(t('admission-reports.countReadmitted'))).toContainText(/[1১]/);

    // The event table lists exactly these students, and B's transfer destination.
    const table = page.getByRole('table', { name: t('admission-reports.caption') });
    await expect(table.getByText(a.full_name).first()).toBeVisible();
    await expect(table.getByText(b.full_name)).toBeVisible();
    await expect(table.getByText(c.full_name)).toBeVisible();
    await expect(table.getByText(DESTINATION)).toBeVisible();
  });

  await test.step('a year with no events shows the empty state, not stale rows', async () => {
    await yearSelect().focus();
    await selectByTypeahead(page, yearNameFor(emptyChain.className));

    await expect(page.getByText(t('admission-reports.emptyMessage'))).toBeVisible();
    await expect(page.getByText(c.full_name)).toHaveCount(0);
  });
});
