/**
 * [Epic 42] Staff import: upload a file, review, confirm, "Import finished".
 * Bulk uploads are closed in DEMO_MODE, so this runs against the same demo database with a
 * server started without DEMO_MODE (GUIDE_PASSWORD makes loginAs use the password form).
 */
import { expect } from '@playwright/test';

import { beat } from '../helpers/capture';
import { gifTour } from '../helpers/gif';
import { tr } from '../helpers/nav';

const n = Date.now().toString().slice(-5);
const csv = [
  'name,mobile,email,role,designation',
  `Rokeya Sultana,,rokeya.sultana${n}@example.com,Teacher,Assistant Teacher`,
  `Imran Hossain,01700000${n.slice(-3)},imran.hossain${n}@example.com,Accountant,`,
  `Shirin Akhter,,shirin.akhter${n}@example.com,Office staff,`,
].join('\n');

gifTour(
  'staff import: file to Import finished',
  { card: 'admin', file: 'staff-import-run.gif' },
  async (p) => {
    await p.goto('/staff/import');
    await expect(
      p.getByRole('heading', { level: 1, name: tr('staffImport', 'title') }),
    ).toBeVisible();
    await beat(p, 1000);
    await p
      .getByLabel(tr('bulkImport', 'chooseFile'))
      .setInputFiles({ name: 'staff.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    const summary = p.getByText(/will be added|যোগ হবে/).first();
    await expect(summary).toBeVisible();
    await beat(p, 800);
    // Keep the demo's phones and emails unsent.
    const invite = p.getByRole('checkbox', { name: tr('staffImport', 'sendInvitations') });
    if (await invite.isChecked().catch(() => false)) await invite.uncheck();
    const confirm = p.getByRole('button', { name: tr('bulkImport', 'confirm'), exact: true });
    await confirm.scrollIntoViewIfNeeded();
    await beat(p, 2000);
    await confirm.click();
    await expect(p.getByRole('heading', { name: tr('staffImport', 'done.title') })).toBeVisible();
    await beat(p, 1500);
  },
);
