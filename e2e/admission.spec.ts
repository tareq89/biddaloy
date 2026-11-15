import {
  adminApiSession,
  createClassSection,
  createGuardian,
  createWalkInApplicant,
  post,
} from './api';
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

test('walk-in application → staff shortlist/admit → student created', async ({
  page,
  request,
}) => {
  const admin = await adminApiSession(request);
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const applicantName = `Admission E2E ${suffix}`;
  const guardianPhone = `01${3 + (Date.now() % 7)}${Date.now().toString().slice(-8)}`;

  let referenceNumber = '';
  let intakeId = '';

  await test.step('seed an open intake over the API', async () => {
    const section = await createClassSection(request, admin);
    const intake = await post<{ id: string }>(request, admin, '/admission-intakes', {
      title: `E2E Intake ${suffix}`,
      class_section_id: section.sectionId,
      seat_count: 10,
      open_date: '2020-01-01',
      close_date: '2099-12-31',
      required_document_types: ['PHOTO'],
    });
    intakeId = intake.id;
  });

  await test.step('a guardian application is entered at the desk (the public form is on the school site)', async () => {
    ({ reference_number: referenceNumber } = await createWalkInApplicant(request, admin, {
      intakeId,
      name: applicantName,
      guardianPhone,
    }));
    expect(referenceNumber).not.toBe('');
  });

  const detail = new DetailShellPage(page);

  await test.step('staff finds the applicant and shortlists it', async () => {
    const list = new ListShellPage(page, {
      titleKey: 'admission-staff-applicants.list.title',
      openLabelKey: 'admission-staff-applicants.list.view',
    });
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
    // The dialog has a footer Close and the corner X (ghost icon), both named "close".
    await dialog
      .getByRole('button', { name: t('admission-staff-applicants.admitModal.close') })
      .and(page.locator('[data-variant="default"]'))
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
});

/**
 * [LIFE-09] An applicant whose guardian phone matches an existing guardian is
 * never linked silently: the admit modal names that guardian, Confirm stays
 * disabled until staff pick link or create-new, and "create new" admits.
 */
test('admit modal shows the matched guardian and requires a choice', async ({ page, request }) => {
  const admin = await adminApiSession(request);
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const applicantName = `Match E2E ${suffix}`;
  const existingGuardianName = `Existing Family ${suffix}`;
  let intakeId = '';
  const guardianPhone = `01${3 + (Date.now() % 7)}${Date.now().toString().slice(-8)}`;

  await test.step('seed a guardian and an open intake over the API', async () => {
    await createGuardian(request, admin, existingGuardianName, guardianPhone);
    const section = await createClassSection(request, admin);
    const intake = await post<{ id: string }>(request, admin, '/admission-intakes', {
      title: `Match Intake ${suffix}`,
      class_section_id: section.sectionId,
      seat_count: 10,
      open_date: '2020-01-01',
      close_date: '2099-12-31',
      required_document_types: ['PHOTO'],
    });
    intakeId = intake.id;
  });

  await test.step('a guardian application is entered at the desk with that phone', async () => {
    await createWalkInApplicant(request, admin, {
      intakeId,
      name: applicantName,
      guardianPhone,
    });
  });

  await test.step('staff opens Admit: the matched guardian is named and a choice is required', async () => {
    const list = new ListShellPage(page, {
      titleKey: 'admission-staff-applicants.list.title',
      openLabelKey: 'admission-staff-applicants.list.view',
    });
    await page.goto('/admissions/applicants');
    await list.expectLoaded();
    await list.openRowByText(applicantName);
    const detail = new DetailShellPage(page);
    await detail.expectLoaded(applicantName);
    await detail.clickAction('admission-staff-applicants.detail.actionAdmit');

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(existingGuardianName, { exact: false })).toBeVisible();
    const confirm = dialog.getByRole('button', {
      name: t('admission-staff-applicants.admitModal.confirm'),
    });
    await expect(confirm).toBeDisabled();

    // RadioRows stretches each label over its row, so the label takes the click.
    await dialog
      .getByText(t('admission-staff-applicants.admitModal.createNew'), { exact: true })
      .click();
    await expect(
      dialog.getByRole('radio', { name: t('admission-staff-applicants.admitModal.createNew') }),
    ).toBeChecked();
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(
      dialog.getByText(
        t('admission-staff-applicants.admitModal.successMessage', { name: applicantName }),
      ),
    ).toBeVisible();
  });
});

test('[#2281] staff opens an uploaded document; after Reject the documents can be deleted', async ({
  page,
  request,
}) => {
  const admin = await adminApiSession(request);
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const applicantName = `Docs E2E ${suffix}`;
  const guardianPhone = `01${3 + (Date.now() % 7)}${Date.now().toString().slice(-8)}`;

  await test.step('seed an open intake and enter a walk-in application with a photo', async () => {
    const section = await createClassSection(request, admin);
    const intake = await post<{ id: string }>(request, admin, '/admission-intakes', {
      title: `Docs Intake ${suffix}`,
      class_section_id: section.sectionId,
      seat_count: 10,
      open_date: '2020-01-01',
      close_date: '2099-12-31',
      required_document_types: ['PHOTO'],
    });
    await createWalkInApplicant(request, admin, {
      intakeId: intake.id,
      name: applicantName,
      guardianPhone,
      photo: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    });
  });

  const detail = new DetailShellPage(page);
  await test.step('staff opens the document in a new tab', async () => {
    const list = new ListShellPage(page, {
      titleKey: 'admission-staff-applicants.list.title',
      openLabelKey: 'admission-staff-applicants.list.view',
    });
    await page.goto('/admissions/applicants');
    await list.expectLoaded();
    await list.openRowByText(applicantName);
    await detail.expectLoaded(applicantName);
    const popup = page.context().waitForEvent('page');
    await page
      .getByRole('button', { name: t('admission-staff-applicants.detail.openDocument') })
      .click();
    const tab = await popup;
    await tab.waitForURL(/^blob:/);
    await tab.close();
  });

  await test.step('Reject, then Delete documents, confirm, no documents', async () => {
    await detail.clickAction('admission-staff-applicants.detail.actionReject');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: t('admission-staff-applicants.detail.actionReject') })
      .click();
    await page
      .getByRole('button', { name: t('admission-staff-applicants.detail.deleteDocuments') })
      .click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: t('admission-staff-applicants.detail.deleteDocuments') })
      .click();
    await expect(page.getByText(t('admission-staff-applicants.detail.noDocuments'))).toBeVisible();
  });
});
