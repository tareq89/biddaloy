import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { SEED_PROGRAM_NAME } from '../seed-contract';
import { tabUntilFocused } from './keyboard-utils';

/**
 * [34.4.3] Programs & milestones, keyboard only — D9's "tick a milestone
 * without a mouse" journey (teacher) and D9's `Alt+↓` milestone reorder
 * (admin). No `page.mouse` and no `.click(` call reaches the interactive
 * surfaces this spec is actually testing — `tabUntilFocused` + a real
 * `page.keyboard.press` throughout, same convention as
 * `grading-scales.spec.ts`.
 *
 * `-students-tab.tsx`'s `MilestoneChecklist` swaps a milestone's checkbox
 * for a different DOM node once it's ticked (unticked plain `<button>` vs.
 * ticked `Popover` trigger) — `StudentsTab`'s `refocusMilestone` (added by
 * this ticket) re-finds and refocuses that new node by
 * `data-milestone-id`, which is what the second `test.step` below actually
 * asserts.
 *
 * There is no confirmation dialog on tick — `onRecord` calls
 * `useRecordAchievements().mutate` directly (`-students-tab.tsx`). The
 * epic body's Wave-4 ticket describes a "dialog opens prefilled with
 * milestone + student, Enter saves" step here; that dialog doesn't exist
 * in the shipped 34.4.1 code, so this test asserts what's actually there —
 * an immediate, optimistic tick — instead.
 */

test.describe('teacher', () => {
  test.use(loggedIn('teacher'));

  test('keyboard-only: find Hifz via the palette, expand a student, tick a milestone, focus returns', async ({
    page,
  }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

    await test.step('Ctrl+K, "prog", land on the programs list', async () => {
      await page.keyboard.press('ControlOrMeta+k');
      await expect(
        page.getByRole('combobox', { name: t('nav.commandPalette.ariaLabel') }),
      ).toBeFocused();
      // Palette opens on the People tab (D11) — "prog" is a page name, not
      // a person, so switch to the Page tab first (`Ctrl+2`), same as
      // `homework.spec.ts`'s `Ctrl+3` for the Action tab.
      await page.keyboard.press('Control+2');
      await expect(
        page.getByRole('tab', { name: t('nav.commandPalette.tabs.page') }),
      ).toHaveAttribute('aria-selected', 'true');
      await page.keyboard.type('prog');
      await expect(page.getByRole('option').first()).toBeVisible();
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await expect(
        page.getByRole('heading', { level: 1, name: t('programs.list.title') }),
      ).toBeVisible();
    });

    await test.step('open Hifz by keyboard', async () => {
      await tabUntilFocused(page, SEED_PROGRAM_NAME, 60, { tag: 'A' });
      await page.keyboard.press('Enter');
      await expect(page.getByRole('heading', { level: 1, name: SEED_PROGRAM_NAME })).toBeVisible();
    });

    await test.step('Tab to the Students tab, activate it', async () => {
      await tabUntilFocused(page, t('programs.detail.tabs.students'), 30, { tag: 'BUTTON' });
      await page.keyboard.press('Enter');
      await expect(
        page.getByRole('tab', { name: t('programs.detail.tabs.students') }),
      ).toHaveAttribute('aria-selected', 'true');
    });

    const firstRowToggle = page.getByRole('tabpanel').locator('button[aria-expanded]').first();

    await test.step('expand the first student row', async () => {
      await firstRowToggle.focus();
      await expect(firstRowToggle).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(firstRowToggle).toHaveAttribute('aria-expanded', 'true');
    });

    await test.step('tick the first unticked milestone, focus returns to it', async () => {
      const firstUnticked = page
        .getByRole('tabpanel')
        .locator('[role="checkbox"][aria-checked="false"]')
        .first();
      const milestoneId = await firstUnticked.getAttribute('data-milestone-id');
      expect(milestoneId).toBeTruthy();

      await firstUnticked.focus();
      await expect(firstUnticked).toBeFocused();
      await page.keyboard.press(' ');

      const ticked = page.locator(`[data-milestone-id="${milestoneId}"][role="checkbox"]`);
      await expect(ticked).toHaveAttribute('aria-checked', 'true');
      await expect(ticked).toBeFocused();
    });
  });
});

test.describe('admin', () => {
  test.use(loggedIn('admin'));

  test('keyboard-only: create a program, add two milestones, reorder with Alt+ArrowDown', async ({
    page,
  }) => {
    const name = `E2E Program ${Date.now()}`;

    // `formDialog.createTitle` ("Add program") is the exact same string as
    // the list page's "Add program" button (`list.actions.add`) — scope to
    // the dialog's own heading so this doesn't strict-mode-violate on two
    // matches.
    const createTitleHeading = page.getByRole('heading', {
      name: t('programs.formDialog.createTitle'),
    });

    await page.goto('/programs?new=1');
    await expect(createTitleHeading).toBeVisible();

    await test.step('fill the name and save', async () => {
      const nameInput = page.getByLabel(t('programs.formDialog.nameLabel'));
      await nameInput.focus();
      await page.keyboard.type(name);
      await tabUntilFocused(page, t('programs.formDialog.save'), 10, { tag: 'BUTTON' });
      await page.keyboard.press('Enter');
      await expect(createTitleHeading).toBeHidden();
    });

    await test.step('open the new program', async () => {
      await tabUntilFocused(page, name, 60, { tag: 'A' });
      await page.keyboard.press('Enter');
      await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    });

    const milestonesList = page.getByRole('list', { name: t('programs.detail.tabs.milestones') });
    const first = `First ${Date.now()}`;
    const second = `Second ${Date.now()}`;

    async function addMilestone(milestoneName: string) {
      const input = page.getByRole('textbox', { name: t('programs.milestones.add') });
      await input.focus();
      await page.keyboard.type(milestoneName);
      await page.keyboard.press('Enter');
      await expect(milestonesList.getByText(milestoneName)).toBeVisible();
    }

    await test.step('add two milestones by keyboard', async () => {
      await addMilestone(first);
      await addMilestone(second);
      await expect(milestonesList.locator('p.font-medium')).toHaveText([first, second]);
    });

    await test.step('Alt+ArrowDown reorders the first milestone down', async () => {
      await tabUntilFocused(page, t('programs.milestones.moveDown'), 20, { tag: 'BUTTON' });
      await page.keyboard.press('Alt+ArrowDown');
      await expect(milestonesList.locator('p.font-medium')).toHaveText([second, first]);
    });
  });
});
