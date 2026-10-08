import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import ExcelJS from 'exceljs';
import { TeacherDesignation, toCsvContent, UserRole } from '@biddaloy/shared';
import { parseDesignation, parseRole, parseStaffSpreadsheet } from './staff-bulk-upload.parser';

const locale = (lang: string) =>
  JSON.parse(
    readFileSync(join(__dirname, `../../../../ui/src/i18n/locales/${lang}/staff.json`), 'utf8'),
  );

async function xlsx(rows: unknown[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('S');
  for (const r of rows) ws.addRow(r as ExcelJS.CellValue[]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('app labels and text hygiene', () => {
  it('accepts every role and designation label the UI shows, en and bn (drift guard)', () => {
    for (const lang of ['en', 'bn']) {
      const { roles, teacherForm } = locale(lang);
      const designations = teacherForm.designations;
      for (const role of Object.keys(roles)) {
        const never = ['SUPER_ADMIN', 'PARENT', 'STUDENT'].includes(role);
        expect(parseRole(roles[role]), `${lang} ${role}`).toBe(never ? undefined : role);
      }
      for (const d of Object.keys(designations)) {
        expect(parseDesignation(designations[d]), `${lang} ${d}`).toBe(d);
      }
    }
  });

  it('matches a decomposed Bangla য় (য + nukta) like the precomposed one', () => {
    expect(parseRole('পরীক্ষা নিয়ন্ত্রক'.normalize('NFD'))).toBe(UserRole.EXAM_CONTROLLER);
    expect(parseDesignation('সমন্বয়ক'.normalize('NFD'))).toBe(TeacherDesignation.COORDINATOR);
  });

  it('flags an Excel number cell in Mobile and keeps a text cell as typed', async () => {
    const buf = await xlsx([
      ['Name', 'Mobile', 'Email', 'Role', 'Designation'],
      ['Num', 1711000101, '', 'Teacher', ''],
      ['Txt', '01711000101', '', 'Teacher', ''],
    ]);
    const rows = await parseStaffSpreadsheet(buf, 'a.xlsx');
    expect(rows.map((r) => r.numericMobile)).toEqual([true, false]);
    expect(rows[1].values.mobile).toBe('01711000101');
  });

  it('reads rich-text cells as their text, and strips spaces from a mobile', async () => {
    const buf = await xlsx([
      ['Name', 'Mobile', 'Email', 'Role', 'Designation'],
      [
        { richText: [{ text: 'Rina ' }, { text: 'Akter', font: { bold: true } }] },
        '01711 000 101',
        '',
        'Teacher',
        '',
      ],
    ]);
    const [row] = await parseStaffSpreadsheet(buf, 'a.xlsx');
    expect(row.values.name).toBe('Rina Akter');
    expect(row.values.mobile).toBe('01711000101');
  });
});

/**
 * #1706 F1/F2: the sample file the app hands out (`client-admin/src/features/staff-import/template.ts`)
 * must import cleanly. Mirrors it exactly: header = `staffImport:columns.<key>.label` in the
 * person's language, role = `staff:roles.<ROLE>`, written through the same `toCsvContent`
 * (BOM + formula guard, which turns `+880…` into `'+880…`).
 */
describe('the app sample file round-trips', () => {
  const staffImport = (lang: string) =>
    JSON.parse(
      readFileSync(
        join(__dirname, `../../../../ui/src/i18n/locales/${lang}/staffImport.json`),
        'utf8',
      ),
    );

  for (const lang of ['en', 'bn']) {
    it(`parses the ${lang} sample with every column found and the sample mobile intact`, async () => {
      const { columns } = staffImport(lang);
      const { roles } = locale(lang);
      const header = ['name', 'phone', 'email', 'role', 'designation'].map(
        (c) => columns[c].label as string,
      );
      const csv = toCsvContent([
        header,
        ['Rahim Uddin', '+8801712345678', '', roles.TEACHER, 'Assistant Teacher'],
        ['Karim Hossain', '', 'karim@example.com', roles.ACCOUNTANT, ''],
      ]);

      const rows = await parseStaffSpreadsheet(Buffer.from(csv, 'utf8'), 'sample.csv');

      expect(rows).toHaveLength(2);
      // The guard's `'` is gone, so the server sees a valid mobile number.
      expect(rows[0].values.mobile).toBe('+8801712345678');
      expect(rows[0].numericMobile).toBe(false);
      expect(parseRole(rows[0].values.role)).toBe(UserRole.TEACHER);
      expect(rows[1].values.email).toBe('karim@example.com');
      expect(parseRole(rows[1].values.role)).toBe(UserRole.ACCOUNTANT);
    });
  }
});
