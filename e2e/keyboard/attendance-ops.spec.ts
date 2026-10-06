import {
  adminApiSession,
  createStudentsInSection,
  get,
  isFridayAnywhere,
  put,
} from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { tabUntilFocused } from './keyboard-utils';

/**
 * [41.4.7] The two palette actions and the screens they open, KEYBOARD
 * ONLY. Every step goes through `page.keyboard` (plus API calls for setup
 * and checks); there is no pointer input anywhere in this file.
 *
 * Palette labels are typed in Bangla because the e2e locale is `bn`; they
 * are the `bn` labels of `attendance.pending` / `attendance.register.edit`
 * in `client-admin/src/action-registry.ts`.
 */
const PENDING_LABEL = 'আজকের বাকি উপস্থিতি';
const EDIT_REGISTER_LABEL = 'মাসিক খাতা সম্পাদনা';

test.use(loggedIn('admin'));

/** A select trigger's accessible text is its current value, not its label, so
 * `tabUntilFocused` cannot find it by label; the page gives it a stable id. */
async function tabUntilId(page: import('@playwright/test').Page, id: string) {
  // Start from the page heading (what route focus does), not the top of the sidebar.
  await page
    .getByRole('heading', { level: 1 })
    .first()
    .evaluate((el) => {
      el.setAttribute('tabindex', '-1');
      el.focus();
    });
  for (let i = 0; i < 90; i += 1) {
    await page.keyboard.press('Tab');
    if ((await page.evaluate(() => document.activeElement?.id)) === id) return;
  }
  throw new Error(`could not reach #${id} within 90 Tab presses`);
}

/** Tab until focus is on a cell of the edit grid. */
async function tabUntilGridCell(page: import('@playwright/test').Page) {
  for (let i = 0; i < 90; i += 1) {
    await page.keyboard.press('Tab');
    if ((await page.evaluate(() => document.activeElement?.getAttribute('role'))) === 'gridcell') {
      return;
    }
  }
  throw new Error('could not reach the edit grid within 90 Tab presses');
}

/** In an open select list, arrow to the option that reads `text` (as many
 * presses as it sits away from the focused one), check focus landed on it,
 * then Enter. Focus moves a frame after each key, so it is asserted, not read. */
async function arrowToOption(page: import('@playwright/test').Page, text: string) {
  const options = page.getByRole('option');
  // The class/section lists load after the page does; arrow keys on an empty list do nothing.
  await expect(options.first()).toBeVisible();
  const labels = (await options.allTextContents()).map((label) => label.trim());
  const target = labels.indexOf(text);
  if (target < 0) throw new Error(`option "${text}" not in the list: ${labels.join(', ')}`);
  const current = await options.evaluateAll((els) =>
    els.indexOf(document.activeElement as HTMLElement),
  );
  const steps = target - Math.max(current, 0);
  for (let i = 0; i < Math.abs(steps); i += 1) {
    await page.keyboard.press(steps > 0 ? 'ArrowDown' : 'ArrowUp');
  }
  await expect(options.nth(target)).toBeFocused();
  await page.keyboard.press('Enter');
}

async function runPaletteAction(page: import('@playwright/test').Page, label: string) {
  await page.keyboard.press('ControlOrMeta+k');
  const input = page.getByRole('combobox', { name: t('nav.commandPalette.ariaLabel') });
  await expect(input).toBeFocused();
  await page.keyboard.press('Control+3'); // Action tab
  await page.keyboard.type(label);
  await expect(page.getByRole('option').first()).toBeVisible();
  await page.keyboard.press('Enter');
}

test("palette: today's pending attendance, down to a section register", async ({
  page,
  request,
}) => {
  // Friday (school closed) turns the unfiltered list into a holiday notice.
  test.skip(isFridayAnywhere(), 'the school is closed on Friday');

  const admin = await adminApiSession(request);
  const chain = await createStudentsInSection(request, admin, 'Ops Kbd Pending Student', 2);

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await runPaletteAction(page, PENDING_LABEL);

  await expect(page).toHaveURL(/\/attendance\?.*status=pending/);
  await expect(
    page.getByRole('heading', { level: 1, name: t('attendance.list.title') }),
  ).toBeVisible();

  // The rows are plain links, so Tab (not the arrow keys) walks them.
  await tabUntilFocused(page, chain.className, 90, { tag: 'a' });
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', { name: `${chain.className} – A`, exact: false }),
  ).toBeVisible();
});

interface Matrix {
  dates: { date: string }[];
  rows: { student_id: string; marks: Record<string, string | null> }[];
  versions: Record<string, number | null>;
}

test('palette: edit the monthly register, mark a cell and save with Ctrl+S', async ({
  page,
  request,
}) => {
  // A freshly created class section is invisible to the register's class
  // picker (it lists the current academic year), so this uses the seeded
  // Class 6 / B and puts every changed day back afterwards.
  const admin = await adminApiSession(request);
  const sections = await get<{ section_id: string; section_name: string; class_name: string }[]>(
    request,
    admin,
    '/attendance/my-sections',
  );
  const section = sections.find((s) => s.class_name === 'Class 6' && s.section_name === 'B');
  if (!section) throw new Error('Seeded Class 6 / B not found — has `yarn seed` run?');
  const matrixPath = `/attendance/sections/${section.section_id}/register-matrix`;
  // The month the page opens on: the SCHOOL's current month (Asia/Dhaka), not
  // `markableDateIso()`'s, which steps back a day on a Friday the 1st.
  const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' })
    .format(new Date())
    .slice(0, 7);
  const before = await get<Matrix>(request, admin, `${matrixPath}?month=${month}`);

  try {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await runPaletteAction(page, EDIT_REGISTER_LABEL);
    await expect(page).toHaveURL(/\/attendance\/register\?.*edit=true/);

    await test.step('pick the class and the section with the keyboard', async () => {
      await tabUntilId(page, 'register-class');
      await page.keyboard.press('Enter');
      await arrowToOption(page, 'Class 6');
      await tabUntilId(page, 'register-section');
      await page.keyboard.press('Enter');
      await arrowToOption(page, 'B');
      await expect(page.getByRole('grid')).toBeVisible();
    });

    await test.step('End jumps to the last open day, a letter sets the status, Ctrl+S saves', async () => {
      await tabUntilGridCell(page);
      await page.keyboard.press('End');
      // Walk left to a day that already has marks, so the `finally` below can
      // put it back exactly (a register the test created could not be removed).
      const focusedLabel = async () =>
        (await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))) ?? '';
      const notMarked = t('attendance.register.notMarked');
      for (let i = 0; i < 31 && (await focusedLabel()).includes(notMarked); i += 1) {
        await page.keyboard.press('ArrowLeft');
      }
      const label = await focusedLabel();
      test.skip(label.includes(notMarked), 'Class 6 / B has no marked day this month yet');
      // Pick a letter that really changes the cell (the seed already has some absences).
      await page.keyboard.press(
        label.includes(t('attendance.statusControl.status.ABSENT')) ? 'p' : 'a',
      );
      await expect(
        page.getByText(t('attendance.register.changedCount_one', { count: 1 })),
      ).toBeVisible();
      // A correction on an already-submitted day wants a reason: Shift+Tab
      // reaches it, and Ctrl+S saves straight from there.
      await page.keyboard.press('Shift+Tab');
      await expect(page.getByLabel(t('attendance.register.reasonLabel'))).toBeFocused();
      await page.keyboard.type('Keyboard journey correction');
      await page.keyboard.press('Control+s');
      // Saving leaves edit mode: the page's Edit action is back.
      await expect(page.getByRole('button', { name: t('attendance.register.edit') })).toBeVisible();
    });

    await test.step('the server recorded the change', async () => {
      const after = await get<Matrix>(request, admin, `${matrixPath}?month=${month}`);
      const changed = after.dates.filter(({ date }) =>
        after.rows.some(
          (row, i) => (row.marks[date] ?? null) !== (before.rows[i]?.marks[date] ?? null),
        ),
      );
      expect(changed).toHaveLength(1);
    });
  } finally {
    const after = await get<Matrix>(request, admin, `${matrixPath}?month=${month}`);
    const days = after.dates.flatMap(({ date }) => {
      const differs = after.rows.some(
        (row, i) => (row.marks[date] ?? null) !== (before.rows[i]?.marks[date] ?? null),
      );
      const entries = before.rows.flatMap((row) =>
        row.marks[date] ? [{ student_id: row.student_id, status: row.marks[date] }] : [],
      );
      return differs && entries.length > 0
        ? [{ date, base_version: after.versions[date] ?? null, entries }]
        : [];
    });
    if (days.length > 0) {
      await put(request, admin, matrixPath, {
        client_request_id: crypto.randomUUID(),
        days,
        reason: 'e2e: put the seeded marks back',
      });
    }
  }
});
