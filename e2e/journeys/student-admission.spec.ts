import {
  adminApiSession,
  createClassSection,
  createGuardian,
  createStudent,
  get,
  patch,
} from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
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
      .getByRole('alertdialog')
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
    // A search is a filter: the shell shows the shared "no matches" state, not the page's own.
    await list.expectEmptyState('common.noMatches.title');
  });
});

test("a stale edit form keeps another editor's address and guardian [2603]", async ({
  page,
  request,
}) => {
  const session = await adminApiSession(request);
  const stamp = Date.now();
  const student = await createStudent(request, session, `Stale ${stamp}`);
  const g1 = await createGuardian(request, session, `Stale G1 ${stamp}`, '01711000001');
  const g2 = await createGuardian(request, session, `Stale G2 ${stamp}`, '01711000002');
  await patch(request, session, `/students/${student.id}`, { guardian_ids: [g1.id] });

  const form = new FormShellPage(page);
  const renamed = `Stale ${stamp} Renamed`;
  await page.goto(`/students/${student.id}/edit`);
  await form.fillField('students.form.fields.fullName', renamed);

  // Editor B saves after A loaded the form.
  await patch(request, session, `/students/${student.id}`, {
    home_address: `B address ${stamp}`,
    guardian_ids: [g1.id, g2.id],
  });

  await form.submit('students.edit.submitAction');
  await expect(page).toHaveURL(new RegExp(`/students/${student.id}$`));

  const saved = await get<{
    full_name: string;
    home_address: string | null;
    guardians: { id: string }[];
  }>(request, session, `/students/${student.id}`);
  expect(saved.full_name).toBe(renamed);
  expect(saved.home_address).toBe(`B address ${stamp}`);
  expect(saved.guardians.map((g) => g.id).sort()).toEqual([g1.id, g2.id].sort());
});

test.describe('a lost reply is not retried [2596]', () => {
  // A service worker hides requests from `page.route`.
  test.use({ serviceWorkers: 'block' });

  test('a 502 after the server saved sends one POST and shows the unknown-outcome toast', async ({
    page,
    request,
  }) => {
    await createClassSection(request, await adminApiSession(request));
    const form = new FormShellPage(page);
    let posts = 0;
    await page.route('**/api/v1/students', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      posts += 1;
      await route.fetch(); // the server really saves it
      return route.fulfill({ status: 502, contentType: 'text/html', body: '<h1>Bad Gateway</h1>' });
    });

    await page.goto('/students/new');
    await form.fillField('students.form.fields.fullName', `Retry ${Date.now()}`);
    await page.getByLabel(t('students.form.fields.class')).click();
    await page.getByRole('option').first().click();
    await page.getByLabel(t('students.form.fields.section')).click();
    await page.getByRole('option').first().click();
    await form.submit('students.new.submitAction');

    await expect(page.getByText(t('common.outcomeUnknown'))).toBeVisible();
    // Past the old 1s + 2s backoff: a retry would have shown up by now.
    await page.waitForTimeout(3500);
    expect(posts).toBe(1);
  });
});

test.describe('double-click on Add student [2594]', () => {
  test.use({ serviceWorkers: 'block' });

  test('a double-click sends one POST and creates one student', async ({ page, request }) => {
    const session = await adminApiSession(request);
    await createClassSection(request, session);
    const form = new FormShellPage(page);
    const name = `Dbl ${Date.now()}`;
    let posts = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/v1/students', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      posts += 1;
      await gate; // the gate, not a sleep, orders the requests
      return route.fallback();
    });

    await page.goto('/students/new');
    await form.fillField('students.form.fields.fullName', name);
    await page.getByLabel(t('students.form.fields.class')).click();
    await page.getByRole('option').first().click();
    await page.getByLabel(t('students.form.fields.section')).click();
    await page.getByRole('option').first().click();
    await page.getByRole('button', { name: t('students.new.submitAction') }).dblclick();
    release();

    await new DetailShellPage(page).expectLoaded(name);
    expect(posts).toBe(1);
    const list = await get<{ data: unknown[] }>(
      request,
      session,
      `/students?search=${encodeURIComponent(name)}`,
    );
    expect(list.data).toHaveLength(1);
  });
});
