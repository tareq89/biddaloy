import { adminApiSession, createGuardian, createStudentWithDues } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { DetailShellPage } from '../pages/detail-shell';
import { ListShellPage } from '../pages/list-shell';

/**
 * [8.5.7] Journey 6: dues queue + single reminder. Seeds a student with
 * a guardian (reminders go to guardians — a guardianless student sends
 * nothing) and an outstanding fee, filters the queue down to them,
 * sends one reminder through the dialog, and checks the student's
 * communication tab records it.
 */

test.use(loggedIn('accountant'));

test('filter the dues queue and send a single reminder', async ({ page, request }) => {
  const session = await adminApiSession(request);
  const name = `Dues Student ${Date.now()}`;
  const guardian = await createGuardian(request, session, `Guardian of ${Date.now()}`);
  const { studentId, chain } = await createStudentWithDues(request, session, name, {
    guardianId: guardian.id,
  });

  const dues = new ListShellPage(page, { titleKey: 'fees.dues.title' });

  await test.step('the seeded student appears in the dues queue', async () => {
    // The queue is shared and paginated — deep-link the class filter
    // (URL-backed list state) so this spec's unique class is page 1
    // regardless of what other specs seeded. The select UI itself only
    // lists the first page of classes.
    await page.goto(`/fees/dues?class_id=${chain.classId}`);
    await dues.expectLoaded();
    await expect(dues.row(name).first()).toBeVisible();
  });

  await test.step('select the row and open the reminder dialog', async () => {
    await dues.row(name).first().getByRole('checkbox').check();
    await page.getByRole('button', { name: t('fees.dues.sendReminder') }).click();
    await expect(
      page.getByRole('dialog').getByRole('heading', {
        name: t('students.sendReminderDialog.title'),
      }),
    ).toBeVisible();
  });

  await test.step('send and get the confirmation', async () => {
    await page
      .getByRole('dialog')
      .getByLabel(t('students.sendReminderDialog.messageLabel'))
      .fill('Reminder: fees are due.');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: t('students.sendReminderDialog.send') })
      .click();
    // The success toast's count comes from the batch response and the
    // actual sending is a background worker — the stable confirmation is
    // the dialog closing (it only closes on a successful batch create).
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  await test.step('the communication tab records it', async () => {
    const detail = new DetailShellPage(page);
    await page.goto(`/students/${studentId}`);
    await detail.expectLoaded(name);
    await detail.openTab('students.detail.tabs.communication', 'communication');
    await expect(page.getByText(t('students.detail.communication.emptyMessage'))).toHaveCount(0);
  });
});
