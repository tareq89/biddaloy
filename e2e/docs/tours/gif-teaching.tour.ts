/** [Epic 42] Teacher assignments: choose a class, add a teacher to a section, remove one. */
import { expect } from '@playwright/test';

import { beat } from '../helpers/capture';
import { gifTour } from '../helpers/gif';
import { tr } from '../helpers/nav';

gifTour(
  'teaching assignments: assign and remove',
  { card: 'admin', file: 'teaching-assignments-assign.gif' },
  async (p) => {
    await p.goto('/staff/teaching-assignments');
    await expect(
      p.getByRole('heading', { level: 1, name: tr('teacherAssignments', 'list.title') }),
    ).toBeVisible();
    await beat(p, 1000);
    await p.locator('#ta-class').click();
    await p
      .getByRole('option', { name: /Class 7/ })
      .first()
      .click();
    await beat(p, 1000);
    const main = p.getByRole('main');
    await main
      .getByRole('button', { name: tr('teacherAssignments', 'list.assign') })
      .first()
      .click();
    const dialog = p.getByRole('dialog', { name: tr('classes', 'assignTeacherForm.title') });
    await expect(dialog).toBeVisible();
    await beat(p);
    const teacher = dialog.getByRole('combobox', {
      name: tr('classes', 'assignTeacherForm.teacherLabel'),
    });
    if ((await p.getByRole('option').count()) === 0) await teacher.click();
    await beat(p, 400);
    const option = p.getByRole('option').nth(1);
    const picked = ((await option.textContent()) ?? '').replace(/\s*\(.*$/, '').trim();
    await option.click();
    await beat(p);
    await dialog.getByRole('button', { name: tr('classes', 'assignTeacherForm.save') }).click();
    await expect(dialog).toBeHidden();
    await beat(p, 1200);
    // Remove the teacher just assigned (top of the first section's table).
    const row = main.locator('table').first().getByRole('row').filter({ hasText: picked }).first();
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: tr('teacherAssignments', 'list.unassign') }).click();
    await beat(p);
    await p
      .getByRole('alertdialog')
      .getByRole('button', { name: tr('teacherAssignments', 'unassignDialog.confirm') })
      .click();
    await beat(p, 1000);
  },
);
