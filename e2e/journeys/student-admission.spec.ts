import { adminApiSession, createClassSection, createStudent } from '../api';
import { loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { DetailShellPage } from '../pages/detail-shell';
import { FormShellPage } from '../pages/form-shell';
import { ListShellPage } from '../pages/list-shell';

/**
 * [8.5.7] Journey 4: student admission — create with validation, edit,
 * delete. Admission requires a class section to exist; the spec seeds
 * its own (parallel-safe, unique names) over the API.
 */

test.use(loggedIn('admin'));

test('empty submit fails with field errors; valid submit lands on the detail', async ({
  page,
  request,
}) => {
  await createClassSection(request, await adminApiSession(request));
  const form = new FormShellPage(page);
  const name = `Admission ${Date.now()}`;

  await test.step('empty submit shows the error summary + field error', async () => {
    await page.goto('/students/new');
    await form.submit('students.new.submitAction');
    await form.expectErrorSummary();
    await form.expectFieldError('students.form.errors.fullNameRequired');
  });

  await test.step('filling required fields succeeds', async () => {
    await form.fillField('students.form.fields.fullName', name);
    // Class/section are comboboxes fed by the section this spec seeded.
    await page.getByLabel(t('students.form.fields.class')).click();
    await page.getByRole('option').first().click();
    await page.getByLabel(t('students.form.fields.section')).click();
    await page.getByRole('option').first().click();
    await form.submit('students.new.submitAction');
  });

  await test.step('lands on the new student detail', async () => {
    const detail = new DetailShellPage(page);
    await detail.expectLoaded(name);
  });
});

test('edit changes a field and the detail shows it; delete removes from the list', async ({
  page,
  request,
}) => {
  const session = await adminApiSession(request);
  const name = `Editable ${Date.now()}`;
  const student = await createStudent(request, session, name);

  const detail = new DetailShellPage(page);
  const form = new FormShellPage(page);
  const renamed = `${name} Renamed`;

  await test.step('edit the name', async () => {
    await page.goto(`/students/${student.id}/edit`);
    await form.fillField('students.form.fields.fullName', renamed);
    await form.submit('students.edit.submitAction');
    await detail.expectLoaded(renamed);
  });

  await test.step('delete via the dialog', async () => {
    await detail.clickAction('students.detail.actions.delete');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: t('students.detail.deleteDialog.confirm') })
      .click();
  });

  await test.step('gone from the list', async () => {
    const list = new ListShellPage(page, {
      titleKey: 'students.list.title',
      searchLabelKey: 'students.list.searchLabel',
    });
    await list.expectLoaded();
    await list.search(renamed);
    await list.expectEmptyState('students.list.emptyMessage');
  });
});
