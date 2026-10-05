import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import ExcelJS from 'exceljs';
import { TeacherDesignation, UserRole } from '@biddaloy/shared';
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
