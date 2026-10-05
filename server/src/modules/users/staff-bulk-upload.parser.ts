import ExcelJS from 'exceljs';
import { Readable } from 'stream';
import { TeacherDesignation, UserRole } from '@biddaloy/shared';

export class StaffUploadParseError extends Error {}

const MAX_DATA_ROWS = 2000;

/** Canonical column keys. Each accepts an English or Bangla header label. */
export const HEADER_LABELS = {
  name: ['name', 'নাম'],
  mobile: ['mobile', 'মোবাইল'],
  email: ['email', 'ইমেইল', 'ই-মেইল'],
  role: ['role', 'ভূমিকা'],
  designation: ['designation', 'পদবি', 'পদবী'],
} as const;
export type StaffHeader = keyof typeof HEADER_LABELS;
const HEADERS = Object.keys(HEADER_LABELS) as StaffHeader[];

export interface StaffParsedRow {
  rowNumber: number;
  values: Record<StaffHeader, string>;
}

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
export function normalizeDigits(s: string): string {
  return s.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
}

const key = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

const ROLE_LABELS: Record<string, UserRole> = {
  অ্যাডমিন: UserRole.ADMIN,
  প্রশাসক: UserRole.ADMIN,
  হিসাবরক্ষক: UserRole.ACCOUNTANT,
  শিক্ষক: UserRole.TEACHER,
  নির্বাহী: UserRole.EXECUTIVE,
  অফিস_সহকারী: UserRole.OFFICE_STAFF,
  অফিস_স্টাফ: UserRole.OFFICE_STAFF,
  পরীক্ষা_নিয়ন্ত্রক: UserRole.EXAM_CONTROLLER,
  কমিটি: UserRole.COMMITTEE,
};

/** Roles an import may grant. SUPER_ADMIN / PARENT / STUDENT are never allowed here. */
export const IMPORTABLE_ROLES: UserRole[] = [
  UserRole.ADMIN,
  UserRole.ACCOUNTANT,
  UserRole.TEACHER,
  UserRole.EXECUTIVE,
  UserRole.OFFICE_STAFF,
  UserRole.EXAM_CONTROLLER,
  UserRole.COMMITTEE,
];

/** `undefined` = not a role we can import (unknown, or one that is never allowed here). */
export function parseRole(cell: string): UserRole | undefined {
  const k = key(cell);
  if (ROLE_LABELS[k]) return ROLE_LABELS[k];
  const byConstant = k.toUpperCase() as UserRole; // also covers "Office staff", "exam-controller"
  return IMPORTABLE_ROLES.includes(byConstant) ? byConstant : undefined;
}

const DESIGNATION_LABELS: Record<string, TeacherDesignation> = {
  শ্রেণি_শিক্ষক: TeacherDesignation.CLASS_TEACHER,
  বিষয়_শিক্ষক: TeacherDesignation.SUBJECT_TEACHER,
  প্রধান_শিক্ষক: TeacherDesignation.HEAD_TEACHER,
  সহকারী_শিক্ষক: TeacherDesignation.ASSISTANT_TEACHER,
  অধ্যক্ষ: TeacherDesignation.PRINCIPAL,
  উপাধ্যক্ষ: TeacherDesignation.VICE_PRINCIPAL,
  সমন্বয়কারী: TeacherDesignation.COORDINATOR,
};

export function parseDesignation(cell: string): TeacherDesignation | undefined {
  const k = key(cell);
  if (DESIGNATION_LABELS[k]) return DESIGNATION_LABELS[k];
  const c = k.toUpperCase() as TeacherDesignation;
  return Object.values(TeacherDesignation).includes(c) ? c : undefined;
}

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    const obj = value as { text?: unknown; result?: unknown };
    if ('text' in obj) return String(obj.text ?? '').trim();
    if ('result' in obj) return String(obj.result ?? '').trim();
  }
  return String(value).trim();
}

async function loadWorksheet(buffer: Buffer, filename: string): Promise<ExcelJS.Worksheet> {
  const dot = filename.lastIndexOf('.');
  const ext = dot === -1 ? '' : filename.slice(dot).toLowerCase();
  const workbook = new ExcelJS.Workbook();
  if (ext === '.xlsx') {
    try {
      await workbook.xlsx.load(buffer as never);
    } catch {
      throw new StaffUploadParseError('Could not read file — is it a valid Excel file?');
    }
    const ws = workbook.worksheets[0];
    if (!ws) throw new StaffUploadParseError('Could not read file — is it a valid Excel file?');
    return ws;
  }
  if (ext === '.csv') {
    try {
      // Identity cell mapper: the default coerces "0171…" / "+880…" through Number().
      return await workbook.csv.read(Readable.from(buffer), { map: (d: string) => d });
    } catch {
      throw new StaffUploadParseError('Could not read file — is it a valid CSV file?');
    }
  }
  throw new StaffUploadParseError(
    `Unsupported file type: ${ext || '(none)'} — upload .xlsx or .csv`,
  );
}

/** Parses the staff sheet. Header labels may be English or Bangla; Bangla digits in Mobile are normalised. */
export async function parseStaffSpreadsheet(
  buffer: Buffer,
  filename: string,
): Promise<StaffParsedRow[]> {
  const ws = await loadWorksheet(buffer, filename);

  const col = new Map<StaffHeader, number>();
  ws.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const label = cellToString(cell.value).toLowerCase();
    const h = HEADERS.find((k) => (HEADER_LABELS[k] as readonly string[]).includes(label));
    if (h && !col.has(h)) col.set(h, colNumber);
  });
  const missing = HEADERS.filter((h) => !col.has(h));
  if (missing.length) {
    throw new StaffUploadParseError(`Missing required columns: ${missing.join(', ')}`);
  }

  const rows: StaffParsedRow[] = [];
  for (let rowNumber = 2; rowNumber <= ws.rowCount; rowNumber++) {
    const row = ws.getRow(rowNumber);
    const values = {} as Record<StaffHeader, string>;
    for (const h of HEADERS) values[h] = cellToString(row.getCell(col.get(h) as number).value);
    if (HEADERS.every((h) => values[h] === '')) continue;
    values.mobile = normalizeDigits(values.mobile);
    rows.push({ rowNumber, values });
  }

  if (rows.length === 0) throw new StaffUploadParseError('File contains no data rows');
  if (rows.length > MAX_DATA_ROWS) {
    throw new StaffUploadParseError(`File has too many rows (max ${MAX_DATA_ROWS})`);
  }
  return rows;
}
