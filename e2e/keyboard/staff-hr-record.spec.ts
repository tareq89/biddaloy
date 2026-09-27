import { adminApiSession, createTeacher } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { tabUntilFocused } from './keyboard-utils';

/**
 * [23.13] Staff detail's HR record tab, KEYBOARD ONLY: tab into the tab
 * strip to reach it, fill in the Job section (an editable form, not a
 * repeatable-row section — the shortest real save round-trip), then add a
 * row to the Family section to prove the repeatable-row-form path also
 * persists. Mirrors `staff-teaching-assignments.spec.ts`'s tab-reaching
 * structure (same `DetailShell` `RovingFocusGroup` tab strip).
 */

test.use(loggedIn('admin'));

test('keyboard-only: fill in the Job section and add a Family row on the HR record tab', async ({
  page,
  request,
}) => {
  const session = await adminApiSession(request);
  const teacherName = `E2E HR Teacher ${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const teacher = await createTeacher(request, session, teacherName);

  await page.goto(`/staff/${teacher.userId}`);
  await expect(page.getByRole('heading', { name: teacherName })).toBeVisible();

  await test.step('tab to the HR record tab, keyboard only', async () => {
    const hrRecordTab = page.getByRole('tab', { name: t('staff.detail.tabs.hrRecord') });
    await expect(hrRecordTab).toBeVisible();
    const tabButtons = page.getByRole('tablist').first().getByRole('tab');
    const tabIds = await tabButtons.evaluateAll((els) => els.map((el) => el.id));
    const targetId = await hrRecordTab.evaluate((el) => el.id);
    const targetIndex = tabIds.indexOf(targetId);
    await tabButtons.first().focus();
    for (let i = 1; i <= targetIndex; i += 1) {
      await page.keyboard.press('ArrowRight');
      if (i < targetIndex) {
        await expect(tabButtons.nth(i)).toBeFocused();
      }
    }
    await expect(hrRecordTab).toHaveAttribute('aria-selected', 'true');
    await expect(hrRecordTab).toHaveAttribute('data-state', 'active');
    await hrRecordTab.focus();
    await page.keyboard.press('Enter');
  });

  await test.step('fill in a Job field, save — keyboard only', async () => {
    // Job starts expanded by default (hr-record-tab.tsx) — no toggle needed;
    // toggling it here would instead COLLAPSE it.
    const addAction = page.getByRole('button', { name: t('staff.hrRecord.job.addAction') });
    await expect(addAction).toBeVisible();
    await addAction.focus();
    await page.keyboard.press('Enter');

    await tabUntilFocused(page, t('staff.hrRecord.job.departmentLabel'), 20);
    await page.keyboard.type('Science');
    await tabUntilFocused(page, t('staff.hrRecord.job.save'), 20, { tag: 'BUTTON' });
    await page.keyboard.press('Enter');

    await expect(page.getByText('Science')).toBeVisible();
  });

  await test.step('expand Family, add a row, save — keyboard only', async () => {
    // `<summary>` (hr-record-tab.tsx uses native details/summary, no
    // Accordion in the design system) — target it directly rather than
    // assume an ARIA role mapping; matches results.test.tsx's own
    // `.closest('summary')` convention for the same element.
    const familyHeading = page.locator('summary', { hasText: t('staff.hrRecord.sections.family') });
    await familyHeading.focus();
    await page.keyboard.press('Enter');

    const addRow = page.getByRole('button', { name: t('staff.hrRecord.addRowAction') });
    await addRow.focus();
    await page.keyboard.press('Enter');

    await tabUntilFocused(page, t('staff.hrRecord.family.relationLabel'), 20);
    await page.keyboard.type('Spouse');
    await page.keyboard.press('Tab');
    await page.keyboard.type('Jane Doe');

    await tabUntilFocused(page, t('staff.hrRecord.saveAction'), 20, { tag: 'BUTTON' });
    await page.keyboard.press('Enter');

    await expect(page.getByText('Jane Doe')).toBeVisible();
  });
});
