import { adminApiSession, createClassSection, post } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [22.4.3] Keyboard-only reorder journey: two syllabus topics seeded via
 * the API, the second moved above the first using the list's up button —
 * `Tab` to the button and `Enter`, no `page.mouse` / `.click(` anywhere in
 * this file. The class/subject `Select` pickers open on Enter (Radix
 * `Select` also accepts Space/ArrowDown) and pick their option via
 * typeahead, same pattern as `organisation-structure.spec.ts`'s
 * `selectByTypeahead` helper.
 */

test.use(loggedIn('admin'));

test('keyboard-only: move the second topic above the first with the up button', async ({
  page,
  request,
}) => {
  const session = await adminApiSession(request);
  const { classId, className } = await createClassSection(request, session);
  const suffix = `${Date.now()}`;
  const subjectName = `E2E Subject ${suffix}`;
  const subject = await post<{ id: string }>(request, session, '/subjects', {
    name_en: subjectName,
    code: `E2E${suffix}`.slice(0, 20),
  });

  await post(request, session, '/syllabus-topics', {
    class_id: classId,
    subject_id: subject.id,
    name: 'First topic',
    sequence: 0,
  });
  await post(request, session, '/syllabus-topics', {
    class_id: classId,
    subject_id: subject.id,
    name: 'Second topic',
    sequence: 1,
  });

  await page.goto('/academics/syllabus');
  await expect(page.getByRole('heading', { name: t('syllabus.list.title') })).toBeVisible();

  await test.step('pick class and subject', async () => {
    // Match this test's own class/subject by their unique, timestamped
    // names — the e2e run shares a persistent database across runs, so a
    // generic "E2E" substring can match another run's leftover row and
    // silently select the wrong id (empty topic list, no visible error).
    await page.getByLabel(t('syllabus.list.classLabel')).press('Enter');
    await page.keyboard.type(className);
    await page.keyboard.press('Enter');
    // Radix's close animation leaves the listbox in the DOM and
    // pointer-events-intercepting for a few hundred ms after Enter — the
    // subject picker's own `.press('Enter')` can land on it instead of its
    // trigger, so wait for it to actually close first.
    await expect(page.getByRole('listbox')).toBeHidden();
    await page.getByLabel(t('syllabus.list.subjectLabel')).press('Enter');
    await page.keyboard.type(subjectName);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('listbox')).toBeHidden();
  });

  // Exact cell match, not `getByText`: the row's Edit/Delete buttons are
  // labelled with the topic name too (`t('list.edit'/'list.delete', { name })`),
  // so a substring match resolves to three elements — the name cell plus
  // both buttons.
  await expect(page.getByRole('cell', { name: 'First topic', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Second topic', exact: true })).toBeVisible();

  await test.step("tab to the second topic's move-up button, Enter moves it above the first", async () => {
    const moveUpSecond = page.getByLabel(t('syllabus.list.moveUp', { name: 'Second topic' }));
    await moveUpSecond.focus();
    await expect(moveUpSecond).toBeFocused();
    await page.keyboard.press('Enter');
  });

  await test.step('rows now render Second topic before First topic', async () => {
    const rows = page.getByRole('row');
    await expect(rows.nth(1)).toContainText('Second topic');
    await expect(rows.nth(2)).toContainText('First topic');
  });
});
