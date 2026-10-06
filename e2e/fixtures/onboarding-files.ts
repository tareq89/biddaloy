import type { UploadFile } from '../pages/staff-import-page';

/**
 * [13.7.1] The two files the onboarding specs upload. Built per run, not
 * checked in: a staff import is a no-op for people already in the school, so
 * the contacts must be new every time. The starter workbook is built from the
 * server's own template (`starterWorkbook` in `../api`) for the same reason.
 */

export interface StaffSheetRows {
  /** Two people: a teacher with an email, an accountant with a mobile. */
  emails: [string, string];
  mobile: string;
}

/** `staff-import-template.csv`'s shape; `bad` swaps one role for one that does not exist. */
export function staffSheet(rows: StaffSheetRows, bad = false): UploadFile {
  const csv = [
    'name,mobile,email,role,designation',
    `Imported Teacher,,${rows.emails[0]},Teacher,Assistant Teacher`,
    `Imported Accountant,${rows.mobile},${rows.emails[1]},${bad ? 'Wizard' : 'Accountant'},`,
  ].join('\n');
  return { name: 'staff.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) };
}

export function uniqueStaffRows(): StaffSheetRows {
  const n = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return {
    emails: [`imp-t-${n}@e2e.example.com`, `imp-a-${n}@e2e.example.com`],
    mobile: `017${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
  };
}

/** Rows for `starterWorkbook`: one academic year + one subject. `bad` drops the subject's required name. */
export function starterRows(bad = false) {
  const n = Date.now();
  return {
    academic_years: [
      {
        id: crypto.randomUUID(),
        name: `Starter ${n}`,
        start_date: '2031-01-01',
        end_date: '2031-12-31',
        is_current: true,
      },
    ],
    subjects: [
      {
        id: crypto.randomUUID(),
        code: `S${n}`.slice(0, 10),
        name_en: bad ? '' : 'Starter Subject',
        name_bn: '',
        is_active: true,
      },
    ],
  };
}
