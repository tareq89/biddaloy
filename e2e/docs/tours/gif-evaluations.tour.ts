/** [Epic 42] Evaluations: start an ACR, score every criterion, complete it. */
import { expect } from '@playwright/test';

import { beat } from '../helpers/capture';
import { gifTour } from '../helpers/gif';
import { tr } from '../helpers/nav';

/** A staff member who has no ACR yet for the current year (set GUIDE_ACR_STAFF to override). */
const STAFF = process.env.GUIDE_ACR_STAFF ?? '';

gifTour(
  'evaluations: start and complete an ACR',
  { card: 'admin', file: 'evaluations-acr.gif' },
  async (p) => {
    await p.goto('/staff/evaluations');
    await expect(p.getByRole('heading', { level: 1 })).toBeVisible();
    await beat(p, 1000);
    await p.getByRole('button', { name: tr('evaluations', 'acr.start') }).click();
    const dialog = p.getByRole('dialog', { name: tr('evaluations', 'acr.startTitle') });
    await expect(dialog).toBeVisible();
    await beat(p);
    // StaffSelect = a search box that narrows a Select; the open Select aria-hides the dialog.
    if (STAFF) {
      const surname = STAFF.split(' ').pop() ?? STAFF;
      await dialog
        .getByRole('textbox', { name: tr('evaluations', 'incident.staffSearch') })
        .pressSequentially(surname, { delay: 60 });
      await beat(p, 1200);
    }
    await dialog.locator('#start-acr-staff').click();
    await expect(p.getByRole('option').first()).toBeVisible();
    await beat(p, 400);
    await p.getByRole('option').filter({ hasText: STAFF }).first().click();
    await beat(p);
    await dialog.getByRole('button', { name: tr('evaluations', 'acr.start'), exact: true }).click();
    await expect(p).toHaveURL(/\/staff\/[^/]+\/acr\/[^/]+$/);
    await beat(p, 1000);
    await p.getByRole('button', { name: tr('common', 'wizard.next') }).click();
    await expect(p.locator('#acr-keyboard-hint')).toBeVisible();
    await beat(p);
    await p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const unscored = p.getByText(tr('evaluations', 'acr.step2.unscored'));
    for (let i = 0; i < 40 && (await unscored.count()) > 0; i++) {
      await p.keyboard.press(String(4 - (i % 2)));
      await p.waitForTimeout(180);
    }
    await beat(p);
    await p.getByRole('button', { name: tr('common', 'wizard.next') }).click();
    await beat(p);
    await p.getByRole('button', { name: tr('evaluations', 'acr.submit') }).click();
    await expect(p.getByText(tr('evaluations', 'acr.completedReadOnly'))).toBeVisible();
    await beat(p, 800);
  },
);
