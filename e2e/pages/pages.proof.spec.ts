import { apiSession, createStudent } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { expectUrlParam } from './assertions';
import { DetailShellPage } from './detail-shell';
import { FormShellPage } from './form-shell';
import { ListShellPage } from './list-shell';

/**
 * [8.5.3] Proof that the archetype page objects drive real routes with
 * zero route-specific table/form code: two different list routes through
 * the same `ListShellPage` class (config = translation keys only), one
 * detail, one form.
 */

test.use(loggedIn('admin'));

test.describe('ListShellPage drives two different list routes', () => {
  test('students list: search narrows to a seeded row, URL carries the state', async ({
    page,
    request,
  }) => {
    const session = await apiSession(request, 'admin');
    const name = `Proof Student ${Date.now()}`;
    await createStudent(request, session, name);

    const list = new ListShellPage(page, {
      titleKey: 'students.list.title',
      searchLabelKey: 'students.list.searchLabel',
    });
    await page.goto('/students');
    await list.expectLoaded();
    await list.search(name);
    await list.expectResultCount(1);
    await expectUrlParam(page, 'search', name);
  });

  test('guardians list: same class, different route, empty state', async ({ page }) => {
    const list = new ListShellPage(page, {
      titleKey: 'guardians.list.title',
      searchLabelKey: 'guardians.list.searchLabel',
    });
    await page.goto('/guardians');
    await list.expectLoaded();
    // Search for something that cannot exist — proves the empty state
    // helper without depending on whether earlier specs seeded guardians.
    await list.search(`no-such-guardian-${Date.now()}`);
    await list.expectEmptyState('guardians.list.emptyMessage');
  });
});

test('DetailShellPage: student detail tabs are URL-backed', async ({ page, request }) => {
  const session = await apiSession(request, 'admin');
  const name = `Proof Detail ${Date.now()}`;
  const student = await createStudent(request, session, name);

  const detail = new DetailShellPage(page);
  await page.goto(`/students/${student.id}`);
  await detail.expectLoaded(name);
  await detail.openTab('students.detail.tabs.fees', 'fees');
});

test('FormShellPage: student admission validation surfaces the error summary', async ({ page }) => {
  const form = new FormShellPage(page);
  await page.goto('/students/new');
  await expect(
    page.getByRole('heading', { level: 1, name: t('students.new.title') }),
  ).toBeVisible();

  await form.submit('students.new.submitAction');
  await form.expectErrorSummary();
  await form.expectFieldError('students.form.errors.fullNameRequired');
});
