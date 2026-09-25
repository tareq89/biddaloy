import { adminApiSession, createClassSection, post } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [22.4.6] Keyboard-only journey over the two new D13/D29 analytics tabs
 * this ticket adds: the student detail page's "Homework" tab and the class
 * detail page's "Homework" tab. Both tab strips are standard ARIA tabs
 * (`DetailShell`/`useDetailShellTab`) — `Home`/`End` jump to the first/last
 * tab, same pattern `detail-shell.test.tsx` documents. No `page.mouse` and
 * no `.click(` anywhere in this file.
 */

test.use(loggedIn('admin'));

test('keyboard-only: student detail Homework tab shows the completion rollup', async ({
  page,
  request,
}) => {
  const admin = await adminApiSession(request);
  const chain = await createClassSection(request, admin);
  const student = await post<{ id: string }>(request, admin, '/students', {
    full_name: 'Kbd Homework Student',
    class_section_id: chain.sectionId,
  });

  await page.goto(`/students/${student.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  // ArrowRight to the Homework tab rather than `End`: this page also has
  // an exams-module tab after it (subject-choices, [19.6.1]), so Homework
  // is no longer necessarily the last tab in the strip.
  const tablist = page.getByRole('tablist');
  const homeworkTab = page.getByRole('tab', { name: t('students.detail.tabs.homework') });
  // Selection comes from the `?tab=` search param (`useDetailShellTab`), set
  // by a router navigation that lands a tick after the keypress moves
  // focus — so the loop has to break on focus, not on `aria-selected`,
  // or it steps past Homework before the attribute updates and wraps
  // around the whole strip.
  const tabCount = await tablist.locator('[role="tab"]').count();
  await tablist.locator('[role="tab"]').first().focus();
  for (let i = 0; i < tabCount; i += 1) {
    if (await homeworkTab.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press('ArrowRight');
  }
  await expect(homeworkTab).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');

  await expect(page.getByText(t('students.detail.homeworkTab.emptyMessage'))).toBeVisible();
});

test('keyboard-only: class detail Homework tab shows the completion and syllabus rollup', async ({
  page,
  request,
}) => {
  const admin = await adminApiSession(request);
  const chain = await createClassSection(request, admin);

  await page.goto(`/classes/${chain.classId}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  const tablist = page.getByRole('tablist');
  await tablist.locator('[role="tab"]').first().focus();
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: t('classes.detail.tabHomework') })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.keyboard.press('Enter');

  await expect(page.getByText(t('classes.detail.homework.emptyMessage'))).toBeVisible();
});
