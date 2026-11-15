/**
 * [Epic 42, redone for Epic 71] Admission walk-in half: the office enters an application for a
 * guardian who comes in. (The guardian's own form is on the school website now, not in the app.)
 * The file keeps its name so it still runs after gif-intakes.tour.ts.
 */
import { expect } from '@playwright/test';

import { beat } from '../helpers/capture';
import { gifTour } from '../helpers/gif';
import { tr } from '../helpers/nav';

const ns = 'admission-desk';

gifTour(
  'admission rounds: the office enters a walk-in application',
  { card: 'admin', file: 'people-admission-clerk-entry-flow.gif' },
  async (p) => {
    await p.goto('/admissions/applicants/new');
    await expect(p.getByRole('heading', { level: 1, name: tr(ns, 'clerk.title') })).toBeVisible();
    await beat(p, 1000);
    // The newest round that is open; the boxes below are that round's own boxes.
    await p.locator('#clerk-round').click();
    await p.getByRole('option').first().click();
    await beat(p, 600);
    await p.locator('#clerk-name').pressSequentially('Tanisha Rahman', { delay: 40 });
    await p.locator('#clerk-guardian_name').pressSequentially('Mizanur Rahman', { delay: 40 });
    await p.locator('#clerk-guardian_phone').pressSequentially('01700000123', { delay: 50 });
    await beat(p, 600);
    const docsLater = p.locator('#clerk-docs-later');
    if (await docsLater.isVisible().catch(() => false)) await docsLater.click();
    await p.getByRole('button', { name: tr(ns, 'clerk.save') }).click();
    await expect(p.getByText(/01700000123|Reference|রেফারেন্স/).first()).toBeVisible();
    await beat(p, 1500);
  },
);
