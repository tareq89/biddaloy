import { adminApiSession, createClassSection, post } from './api';
import { expect, loggedIn, test } from './fixtures/test';
import { t } from './i18n';
import { DetailShellPage } from './pages/detail-shell';
import { ListShellPage } from './pages/list-shell';

/**
 * [27.11] Full online-admission journey: a guardian submits a public
 * application (no login) → staff finds it, shortlists it, and admits it
 * (converting it to a Student) → the same reference number now shows
 * ADMITTED on the public status-check page.
 *
 * The intake is created over the API (same "seed what the UI doesn't
 * need to build" convention `journeys/student-admission.spec.ts` uses for
 * its class section) so this spec only drives the UI for the parts the
 * ticket actually exercises: the public form, the staff review, and the
 * public status check.
 */
test.use(loggedIn('admin'));

test('public submit → staff shortlist/admit → student created → public status shows ADMITTED', async ({
  page,
  request,
}) => {
  const admin = await adminApiSession(request);
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const applicantName = `Admission E2E ${suffix}`;
  const guardianPhone = `1${3 + (Date.now() % 7)}${Date.now().toString().slice(-8)}`;

  let referenceNumber = '';

  await test.step('seed an open intake over the API', async () => {
    const section = await createClassSection(request, admin);
    await post(request, admin, '/admission-intakes', {
      title: `E2E Intake ${suffix}`,
      class_section_id: section.sectionId,
      seat_count: 10,
      open_date: '2020-01-01',
      close_date: '2099-12-31',
      required_document_types: ['PHOTO'],
    });
  });

  await test.step('a guardian submits the public application, no login', async () => {
    // Fresh, signed-out context — this test is `loggedIn('admin')` for the
    // staff half below, but the public form must never see that session.
    const guestContext = await page.context().browser()!.newContext();
    const guestPage = await guestContext.newPage();

    await guestPage.goto('/admission/default-school');
    await guestPage
      .getByLabel(t('admission-public.form.fields.applicantName'), { exact: true })
      .fill(applicantName);
    await guestPage
      .getByLabel(t('admission-public.form.fields.dateOfBirth'), { exact: true })
      .fill('2018-06-01');
    await guestPage
      .getByLabel(t('admission-public.form.fields.gender'), { exact: true })
      .selectOption('MALE');
    await guestPage
      .getByLabel(t('admission-public.form.fields.guardianName'), { exact: true })
      .fill(`Guardian of ${applicantName}`);
    await guestPage
      .getByLabel(t('admission-public.form.fields.guardianPhone'), { exact: true })
      .fill(guardianPhone);
    await guestPage
      .getByLabel(t('admission-public.form.documents.PHOTO'), { exact: true })
      .setInputFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('x') });

    await guestPage.getByRole('button', { name: t('admission-public.form.submit') }).click();

    const referenceLocator = guestPage.getByTestId('reference-number');
    await referenceLocator.waitFor();
    referenceNumber = (await referenceLocator.textContent())?.trim() ?? '';
    expect(referenceNumber).not.toBe('');

    await guestContext.close();
  });

  const detail = new DetailShellPage(page);

  await test.step('staff finds the applicant and shortlists it', async () => {
    const list = new ListShellPage(page, { titleKey: 'admission-staff-applicants.list.title' });
    await page.goto('/admissions/applicants');
    await list.expectLoaded();
    await list.openRowByText(applicantName);

    await detail.expectLoaded(applicantName);
    await detail.clickAction('admission-staff-applicants.detail.actionShortlist');

    const dialog = page.getByRole('dialog');
    await dialog
      .getByLabel(t('admission-staff-applicants.evaluate.notesLabel'))
      .fill('Looks good on paper.');
    await dialog
      .getByRole('button', { name: t('admission-staff-applicants.evaluate.save') })
      .click();
    await expect(dialog).toBeHidden();
  });

  await test.step('staff admits the applicant', async () => {
    await detail.clickAction('admission-staff-applicants.detail.actionAdmit');

    const dialog = page.getByRole('dialog');
    await dialog
      .getByRole('button', { name: t('admission-staff-applicants.admitModal.confirm') })
      .click();
    await expect(
      dialog.getByText(
        t('admission-staff-applicants.admitModal.successMessage', { name: applicantName }),
      ),
    ).toBeVisible();
    await dialog
      .getByRole('button', { name: t('admission-staff-applicants.admitModal.close') })
      .click();
  });

  await test.step('the new student appears in the students list', async () => {
    const list = new ListShellPage(page, {
      titleKey: 'students.list.title',
      searchLabelKey: 'students.list.searchLabel',
    });
    await page.goto('/students');
    await list.expectLoaded();
    await list.search(applicantName);
    await list.expectResultCount(1);
  });

  await test.step('the public status page shows ADMITTED for the same reference number', async () => {
    const guestContext = await page.context().browser()!.newContext();
    const guestPage = await guestContext.newPage();

    await guestPage.goto('/admission/default-school/status');
    await guestPage
      .getByLabel(t('admission-public.status.fields.referenceNumber'), { exact: true })
      .fill(referenceNumber);
    await guestPage.getByRole('button', { name: t('admission-public.status.submit') }).click();

    await expect(guestPage.getByText(t('admission-public.status.statuses.ADMITTED'))).toBeVisible();

    await guestContext.close();
  });
});
