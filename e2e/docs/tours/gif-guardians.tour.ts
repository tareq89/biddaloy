/** [Epic 42] Guardians: invite guardians, from the preview to sending (DEMO_MODE logs every send). */
import { expect } from '@playwright/test';

import { beat } from '../helpers/capture';
import { gifTour } from '../helpers/gif';
import { tr } from '../helpers/nav';

gifTour(
  'guardians: invitation preview to sending',
  { card: 'admin', file: 'guardians-invite.gif' },
  async (p) => {
    await p.goto('/guardians');
    await expect(
      p.getByRole('heading', { level: 1, name: tr('guardians', 'list.title') }),
    ).toBeVisible();
    await beat(p, 1000);
    await p.getByRole('button', { name: tr('guardians', 'invite.trigger') }).click();
    const dialog = p.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', { name: tr('guardians', 'invite.title') }),
    ).toBeVisible();
    await beat(p, 1000);
    await dialog.getByRole('button', { name: tr('guardians', 'invite.select.runPreview') }).click();
    await beat(p, 1200);
    await dialog.getByRole('button', { name: tr('common', 'wizard.next') }).click();
    await beat(p, 1500);
    await dialog.getByRole('button', { name: tr('guardians', 'invite.confirm') }).click();
    await expect(dialog.getByText(/Done|সম্পন্ন/)).toBeVisible({ timeout: 60_000 });
    await beat(p, 1200);
  },
);
