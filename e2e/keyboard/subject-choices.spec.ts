import { adminApiSession, createClassSection, currentAcademicYear, post } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { tabUntilFocused } from './keyboard-utils';

/**
 * [35.1.13] #1305's keyboard acceptance: on the student's Subject choices
 * tab, Tab reaches each "one of" choice group, and the arrow keys move (and
 * pick) within a group. Each group is a Radix `RadioGroup`, so the whole
 * group is ONE Tab stop and the arrows rove inside it. No `page.mouse` and no
 * `.click(` anywhere in this file.
 */

test.use(loggedIn('admin'));

test('keyboard-only: Tab reaches each choice group, arrows move within it', async ({
  page,
  request,
}) => {
  const admin = await adminApiSession(request);
  // The panel only reads the CURRENT academic year, so the class must live there.
  const chain = await createClassSection(request, admin, await currentAcademicYear(request, admin));
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const groups = {
    [`Religion ${suffix}`]: ['Islam', 'Hindu'],
    [`Elective ${suffix}`]: ['Agri', 'Home'],
  };
  for (const [group, members] of Object.entries(groups)) {
    for (const member of members) {
      const subject = await post<{ id: string }>(request, admin, '/subjects', {
        name_en: `${member} ${suffix}`,
        code: `${member.slice(0, 2).toUpperCase()}${suffix}`.slice(0, 20),
      });
      await post(request, admin, `/classes/${chain.classId}/subjects`, {
        subject_id: subject.id,
        academic_year_id: chain.academicYearId,
        choice_group: group,
      });
    }
  }
  const student = await post<{ id: string }>(request, admin, '/students', {
    full_name: 'Kbd Choice Student',
    class_section_id: chain.sectionId,
  });

  await page.goto(`/students/${student.id}?tab=subject-choices`);
  const tab = page.getByRole('tab', { name: t('exams.detail.tabs.fourthSubject') });
  await expect(tab).toHaveAttribute('aria-selected', 'true');

  // Groups render in the order the server lists them; read it from the page
  // once both have loaded.
  for (const group of Object.keys(groups)) {
    await expect(page.getByRole('group', { name: group })).toBeVisible();
  }
  const legends = await page.locator('fieldset > legend').allTextContents();
  const order = legends.filter((l) => l in groups);
  expect(order).toHaveLength(2);
  const radiosOf = (group: string) => page.getByRole('group', { name: group }).getByRole('radio');
  // Hold the arrow until focus lands, as a person does. Radix moves focus in a
  // setTimeout and only picks the radio if the arrow is still down by then;
  // `keyboard.press` releases instantly, so it would move focus without picking.
  const arrow = async (key: 'ArrowDown' | 'ArrowUp', to: ReturnType<typeof radiosOf>) => {
    await page.keyboard.down(key);
    await expect(to).toBeFocused();
    await page.keyboard.up(key);
  };

  await tab.focus();
  const [first, second] = [radiosOf(order[0]!), radiosOf(order[1]!)];
  // Nothing picked yet, so each group's Tab stop is its first member.
  // `tag`: the focusable tab panel's text contains every subject name too.
  await tabUntilFocused(
    page,
    (await first.nth(0).evaluate((el) => el.closest('label')!.textContent!)).trim(),
    5,
    { tag: 'BUTTON' },
  );
  await expect(first.nth(0)).toBeFocused();

  // Arrow moves focus AND picks within the group (Radix radio semantics).
  // The checkmark updates optimistically, so also prove the pick was saved.
  const saved = page.waitForResponse(
    (r) => r.request().method() === 'PUT' && r.url().includes('/subject-choices'),
  );
  await arrow('ArrowDown', first.nth(1));
  expect((await saved).ok()).toBe(true);
  await expect(first.nth(1)).toHaveAttribute('aria-checked', 'true');
  await arrow('ArrowUp', first.nth(0));
  await expect(first.nth(0)).toHaveAttribute('aria-checked', 'true');

  // One Tab leaves the whole first group and lands in the second.
  await page.keyboard.press('Tab');
  await expect(second.nth(0)).toBeFocused();
  await arrow('ArrowDown', second.nth(1));
  await expect(second.nth(1)).toHaveAttribute('aria-checked', 'true');
  // Picking in the second group left the first group's pick alone.
  await expect(first.nth(0)).toHaveAttribute('aria-checked', 'true');
});
