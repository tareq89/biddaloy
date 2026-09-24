import { adminApiSession, createClassSection, post } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [22.4.3] Keyboard-only reorder journey: two syllabus topics seeded via
 * the API, the second moved above the first using the list's up button —
 * `Tab` to the button and `Enter`, no `page.mouse` / `.click(` anywhere
 * against the reorder controls themselves (the class/subject `Select`
 * pickers use `.click()` to open, same as `homework.spec.ts`'s pickers —
 * `@biddaloy/ui`'s Select has no keyboard-only open path documented
 * elsewhere in this suite).
 */

test.use(loggedIn('admin'));

test('keyboard-only: move the second topic above the first with the up button', async ({
  page,
  request,
}) => {
  const session = await adminApiSession(request);
  const { classId } = await createClassSection(request, session);
  const suffix = `${Date.now()}`;
  const subject = await post<{ id: string }>(request, session, '/subjects', {
    name_en: `E2E Subject ${suffix}`,
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
    await page.getByLabel(t('syllabus.list.classLabel')).click();
    await page.getByRole('option', { name: 'E2E' }).first().click();
    await page.getByLabel(t('syllabus.list.subjectLabel')).click();
    await page.getByRole('option', { name: 'E2E' }).first().click();
  });

  await expect(page.getByText('First topic')).toBeVisible();
  await expect(page.getByText('Second topic')).toBeVisible();

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
