/** [Epic 42] Programs: add a program, a milestone, enrol a student, record an achievement. */
import { expect } from '@playwright/test';

import { beat } from '../helpers/capture';
import { gifTour } from '../helpers/gif';
import { tr } from '../helpers/nav';

const NAME = process.env.GUIDE_PROGRAM_NAME ?? 'Robotics club';

gifTour(
  'programs: add program to achievement',
  { card: 'admin', file: 'programs-add-achieve.gif' },
  async (p) => {
    await p.goto('/programs');
    await expect(
      p.getByRole('heading', { level: 1, name: tr('programs', 'list.title') }),
    ).toBeVisible();
    await beat(p, 1000);
    await p.getByRole('button', { name: tr('programs', 'actions.add') }).click();
    await beat(p);
    await p
      .getByLabel(tr('programs', 'formDialog.nameLabel'))
      .pressSequentially(NAME, { delay: 40 });
    await beat(p);
    await p.getByRole('button', { name: tr('programs', 'formDialog.save') }).click();
    const link = p.getByRole('main').getByRole('link', { name: NAME, exact: true });
    await expect(link).toBeVisible();
    await beat(p);
    await link.click();
    await expect(p.getByRole('heading', { level: 1, name: NAME })).toBeVisible();
    await beat(p);
    // Milestone
    await p
      .locator('#milestone-add-name')
      .pressSequentially('Build a line-following robot', { delay: 30 });
    await beat(p, 400);
    await p.getByRole('button', { name: tr('programs', 'milestones.add') }).click();
    await beat(p);
    // Enrol
    await p.getByRole('tab', { name: tr('programs', 'detail.tabs.students') }).click();
    await beat(p);
    await p
      .getByRole('tabpanel')
      .getByRole('button', { name: /Enrol|ভর্তি/ })
      .click();
    const dialog = p.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await beat(p);
    await dialog.locator('#enrol-class').click();
    await p.getByRole('option').first().click();
    await beat(p);
    const first = dialog.getByRole('checkbox').first();
    await expect(first).toBeVisible();
    await first.check();
    await beat(p);
    await dialog
      .getByRole('button', { name: tr('programs', 'students.enrol'), exact: true })
      .click();
    await expect(dialog).toBeHidden();
    await beat(p);
    // Record: expand the student's row and tick the milestone.
    const tab = p.getByRole('tab', { name: tr('programs', 'detail.tabs.students') });
    if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
    const row = p
      .getByRole('list', { name: tr('programs', 'studentTab.listLabel') })
      .getByRole('listitem')
      .first();
    await expect(row).toBeVisible();
    await row.locator('button[aria-expanded]').first().click();
    await beat(p);
    const box = row.locator('[role="checkbox"][aria-checked="false"]').first();
    await box.click();
    await expect(row.locator('[role="checkbox"][aria-checked="true"]').first()).toBeVisible();
  },
);
