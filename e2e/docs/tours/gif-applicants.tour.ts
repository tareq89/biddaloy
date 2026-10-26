/** [Epic 42] Admission applicants: open a pending application, see its papers, shortlist, admit. */
import { expect } from '@playwright/test';

import { beat } from '../helpers/capture';
import { gifTour } from '../helpers/gif';
import { tr } from '../helpers/nav';

const ns = 'admission-staff-applicants';

gifTour(
  'applicants: open, shortlist, admit',
  { card: 'office-staff', file: 'people-admission-applicants-flow.gif' },
  async (p) => {
    await p.goto('/admissions/applicants?status=PENDING');
    await expect(p.getByRole('heading', { level: 1, name: tr(ns, 'list.title') })).toBeVisible();
    await beat(p, 1000);
    const row = p
      .getByRole('main')
      .getByRole('row')
      .filter({ hasText: tr(ns, 'list.statusPending') })
      .first();
    await row.getByRole('link').first().click();
    const docs = p
      .getByRole('main')
      .getByRole('heading', { name: tr(ns, 'detail.sectionDocuments') });
    await expect(docs).toBeVisible();
    await beat(p, 800);
    await docs.scrollIntoViewIfNeeded();
    await beat(p, 1000);
    await p.getByRole('button', { name: tr(ns, 'detail.actionShortlist') }).click();
    const dialog = p.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await beat(p);
    await dialog
      .getByLabel(tr(ns, 'evaluate.notesLabel'))
      .pressSequentially('Papers complete, good report card.', { delay: 25 });
    await dialog.getByRole('button', { name: tr(ns, 'evaluate.save') }).click();
    await expect(dialog).toBeHidden();
    await beat(p, 1000);
    await p.getByRole('button', { name: tr(ns, 'detail.actionAdmit') }).click();
    const admit = p.getByRole('dialog');
    await expect(admit).toBeVisible();
    await beat(p, 1000);
    await admit.getByRole('button', { name: tr(ns, 'admitModal.confirm') }).click();
    await expect(admit.getByText(/has been admitted|ভর্তি/)).toBeVisible();
    await beat(p, 1200);
  },
);
