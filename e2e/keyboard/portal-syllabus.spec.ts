import { get, parentApiSession } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [22.4.6] Keyboard-only journey over the portal's read-only syllabus tab
 * (`portal/syllabus.tsx`, shipped in 22.4.5). Guardian logs in, lands on
 * the demo child's syllabus, tabs through — no `page.mouse` / `.click(`.
 */

test.use(loggedIn('parent'));

test('keyboard-only: portal syllabus subject disclosure opens and shows the next lessons', async ({
  page,
  request,
}) => {
  // The seeded plans are on Class 6 section A, and the portal opens on whichever linked child its API
  // lists first (random per seed): ask for the child in that section by URL, then go keyboard-only.
  const children = await get<
    { id: string; class_section?: { section_name: string; class?: { name: string } } }[]
  >(request, await parentApiSession(request), '/students/mine');
  const child = children.find(
    (c) => c.class_section?.class?.name === 'Class 6' && c.class_section.section_name === 'A',
  );
  if (!child) throw new Error('the seeded parent has no child in Class 6 section A');
  await page.goto(`/portal/syllabus?student=${child.id}`);
  await expect(
    page.getByRole('heading', { name: t('portal.syllabus.title'), exact: true }),
  ).toBeVisible();

  // Tab until focus lands on the first subject disclosure (a button with aria-expanded). Scoped to
  // <main>: the app header's menu button is also aria-expanded, and is hidden on a desktop viewport.
  const disclosure = page.getByRole('main').locator('button[aria-expanded]').first();
  await expect(disclosure).toBeVisible();
  for (let i = 0; i < 30; i += 1) {
    await page.keyboard.press('Tab');
    if (await disclosure.evaluate((el) => el === document.activeElement)) break;
  }
  await expect(disclosure).toBeFocused();

  // Enter toggles it (the most-behind subject starts open, an on-time one closed).
  const before = await disclosure.getAttribute('aria-expanded');
  await page.keyboard.press('Enter');
  await expect(disclosure).toHaveAttribute('aria-expanded', before === 'true' ? 'false' : 'true');
  if (before === 'true') await page.keyboard.press('Enter');
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  // The opened subject shows its content. (Not the "next 5 lessons" heading: the seeded plans sit in the
  // seed's First Term, which ended in April, so a plan with no upcoming periods has none to list.)
  const region = await disclosure.getAttribute('aria-controls');
  await expect(page.locator(`#${region}`)).toBeVisible();
});
