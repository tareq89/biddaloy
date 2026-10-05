import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { TeacherDesignation, UserRole } from '@biddaloy/shared';
import {
  parseDesignation,
  parseRole,
  parseStaffSpreadsheet,
  StaffUploadParseError,
} from './staff-bulk-upload.parser';

async function xlsx(rows: string[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Staff');
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('parseStaffSpreadsheet', () => {
  it('reads English headers in any order and any case', async () => {
    const buf = await xlsx([
      ['ROLE', 'Name', 'Email', 'mobile', 'Designation'],
      ['Teacher', 'Rina', 'rina@x.com', '01711111111', 'Class teacher'],
    ]);
    const [row] = await parseStaffSpreadsheet(buf, 'a.xlsx');
    expect(row.values).toEqual({
      name: 'Rina',
      email: 'rina@x.com',
      mobile: '01711111111',
      role: 'Teacher',
      designation: 'Class teacher',
    });
  });

  it('reads Bangla headers and turns Bangla digits in Mobile into ASCII digits', async () => {
    const buf = await xlsx([
      ['নাম', 'মোবাইল', 'ইমেইল', 'ভূমিকা', 'পদবি'],
      ['রিনা', '০১৭১১১১১১১১', '', 'শিক্ষক', ''],
    ]);
    const [row] = await parseStaffSpreadsheet(buf, 'a.xlsx');
    expect(row.values.mobile).toBe('01711111111');
    expect(row.values.name).toBe('রিনা');
  });

  it('names the missing columns', async () => {
    const buf = await xlsx([
      ['Name', 'Mobile'],
      ['A', '1'],
    ]);
    await expect(parseStaffSpreadsheet(buf, 'a.xlsx')).rejects.toThrow(
      /Missing required columns: email, role, designation/,
    );
  });

  it('rejects an unsupported extension and a header-only file', async () => {
    await expect(parseStaffSpreadsheet(Buffer.from(''), 'a.pdf')).rejects.toBeInstanceOf(
      StaffUploadParseError,
    );
    const buf = await xlsx([['Name', 'Mobile', 'Email', 'Role', 'Designation']]);
    await expect(parseStaffSpreadsheet(buf, 'a.xlsx')).rejects.toThrow(/no data rows/);
  });

  it('keeps a leading zero / plus in a CSV mobile', async () => {
    const csv = Buffer.from('Name,Mobile,Email,Role,Designation\nA,+8801711111111,,Teacher,\n');
    const [row] = await parseStaffSpreadsheet(csv, 'a.csv');
    expect(row.values.mobile).toBe('+8801711111111');
  });
});

describe('parseRole', () => {
  it('maps en label, constant and bn label to the role', () => {
    expect(parseRole('Office staff')).toBe(UserRole.OFFICE_STAFF);
    expect(parseRole('exam-controller')).toBe(UserRole.EXAM_CONTROLLER);
    expect(parseRole('TEACHER')).toBe(UserRole.TEACHER);
    expect(parseRole('শিক্ষক')).toBe(UserRole.TEACHER);
    expect(parseRole('হিসাবরক্ষক')).toBe(UserRole.ACCOUNTANT);
  });

  it('never returns SUPER_ADMIN, PARENT or STUDENT', () => {
    expect(parseRole('SUPER_ADMIN')).toBeUndefined();
    expect(parseRole('Parent')).toBeUndefined();
    expect(parseRole('student')).toBeUndefined();
    expect(parseRole('gardener')).toBeUndefined();
  });
});

describe('parseDesignation', () => {
  it('maps labels and constants, and returns undefined for unknown', () => {
    expect(parseDesignation('Head teacher')).toBe(TeacherDesignation.HEAD_TEACHER);
    expect(parseDesignation('প্রধান শিক্ষক')).toBe(TeacherDesignation.HEAD_TEACHER);
    expect(parseDesignation('Wizard')).toBeUndefined();
  });
});
