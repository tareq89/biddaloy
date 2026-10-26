/**
 * [Epic 42] Calendar import: choose a file, check it, review the rows, confirm.
 * Calendar import is closed in DEMO_MODE, so this runs against the same demo database with a
 * server started without DEMO_MODE (GUIDE_PASSWORD makes loginAs use the password form).
 */
import { expect } from '@playwright/test';

import { beat } from '../helpers/capture';
import { gifTour } from '../helpers/gif';
import { tr } from '../helpers/nav';

const header =
  'type,name,start_date,end_date,start_time,end_time,counts_as_working_day,audience,classes,description';
const rows = [
  ['HOLIDAY', 'Victory Day', '2026-12-16', '2026-12-16', '', '', 'FALSE', 'ALL', '', ''],
  [
    'EVENT',
    'Annual prize giving',
    '2026-12-20',
    '2026-12-20',
    '10:00',
    '13:00',
    'TRUE',
    'ALL',
    '',
    '',
  ],
  ['EVENT', 'Parent-teacher meeting', '2026-12-23', '2026-12-23', '', '', 'TRUE', 'ALL', '', ''],
];
const csv = `${header}\n${rows.map((r) => r.join(',')).join('\n')}\n`;

gifTour(
  'calendar import: file to confirm',
  { card: 'admin', file: 'calendar-import-run.gif' },
  async (p) => {
    await p.goto('/calendar/import');
    await expect(
      p.getByRole('heading', { level: 1, name: tr('calendarImport', 'pageTitle') }),
    ).toBeVisible();
    await beat(p, 1000);
    await p
      .getByLabel(tr('calendarImport', 'step1.chooseFile'))
      .setInputFiles({ name: 'calendar.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await beat(p, 1000);
    await p.getByRole('button', { name: tr('calendarImport', 'step1.check') }).click();
    await expect(p.getByText(tr('calendarImport', 'step2.title'))).toBeVisible();
    await beat(p, 2000);
    await p.getByRole('button', { name: tr('calendarImport', 'step3.commit') }).click();
    await expect(p.getByText(tr('calendarImport', 'success.title'))).toBeVisible();
    await beat(p, 1500);
  },
);
