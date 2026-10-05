import ExcelJS from 'exceljs';
import { Readable } from 'stream';
import { STAFF_ROLES, TeacherDesignation, UserRole } from '@biddaloy/shared';

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
  /** Mobile came as an Excel number: its leading 0 is already gone, so it cannot be trusted. */
  numericMobile: boolean;
}

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
export function normalizeDigits(s: string): string {
  return s.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
}

/** NFC first: Bangla `য়` can arrive precomposed or as য + nukta depending on the keyboard. */
const nfc = (s: string) => s.normalize('NFC');
const key = (s: string) =>
  nfc(s)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

// En/bn labels as the app shows them (ui/src/i18n/locales/{en,bn}/staff.json). The spec
// compares these against those files, so they cannot drift unnoticed.
const ROLE_NAMES: [UserRole, string[]][] = [
  [UserRole.ADMIN, ['Admin', 'অ্যাডমিন']],
  [UserRole.ACCOUNTANT, ['Accountant', 'হিসাবরক্ষক']],
  [UserRole.TEACHER, ['Teacher', 'শিক্ষক']],
  [UserRole.EXECUTIVE, ['Academic coordinator', 'একাডেমিক কো-অর্ডিনেটর']],
  [UserRole.OFFICE_STAFF, ['Office staff', 'অফিস সহকারী']],
  [UserRole.EXAM_CONTROLLER, ['Exam controller', 'পরীক্ষা নিয়ন্ত্রক']],
  [UserRole.COMMITTEE, ['Committee member', 'পরিচালনা পর্ষদ সদস্য']],
];
export const ROLE_LABELS: Record<string, UserRole> = Object.fromEntries(
  ROLE_NAMES.flatMap(([role, names]) => [role, ...names].map((n) => [key(n), role])),
);

/** Roles an import may grant: staff roles, never SUPER_ADMIN (PARENT / STUDENT are not staff). */
export const IMPORTABLE_ROLES: UserRole[] = STAFF_ROLES.filter((r) => r !== UserRole.SUPER_ADMIN);

/** `undefined` = not a role we can import (unknown, or one that is never allowed here). */
export function parseRole(cell: string): UserRole | undefined {
  const role = ROLE_LABELS[key(cell)];
  return role && IMPORTABLE_ROLES.includes(role) ? role : undefined;
}

const DESIGNATION_NAMES: [TeacherDesignation, string[]][] = [
  [TeacherDesignation.CLASS_TEACHER, ['Class teacher', 'শ্রেণি শিক্ষক']],
  [TeacherDesignation.SUBJECT_TEACHER, ['Subject teacher', 'বিষয় শিক্ষক']],
  [TeacherDesignation.HEAD_TEACHER, ['Head teacher', 'প্রধান শিক্ষক']],
  [TeacherDesignation.ASSISTANT_TEACHER, ['Assistant teacher', 'সহকারী শিক্ষক']],
  [TeacherDesignation.PRINCIPAL, ['Principal', 'অধ্যক্ষ']],
  [TeacherDesignation.VICE_PRINCIPAL, ['Vice principal', 'উপাধ্যক্ষ']],
  [TeacherDesignation.COORDINATOR, ['Coordinator', 'সমন্বয়ক', 'সমন্বয়কারী']],
];
export const DESIGNATION_LABELS: Record<string, TeacherDesignation> = Object.fromEntries(
  DESIGNATION_NAMES.flatMap(([d, names]) => [d, ...names].map((n) => [key(n), d])),
);

export function parseDesignation(cell: string): TeacherDesignation | undefined {
  return DESIGNATION_LABELS[key(cell)];
}

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    const obj = value as {
      text?: unknown;
      result?: unknown;
      richText?: { text: string }[];
      error?: unknown;
    };
    if (obj.richText)
      return nfc(
        obj.richText
          .map((r) => r.text)
          .join('')
          .trim(),
      );
    if ('error' in obj) return '';
    if ('text' in obj) return nfc(String(obj.text ?? '').trim());
    if ('result' in obj) return nfc(String(obj.result ?? '').trim());
  }
  return nfc(String(value).trim());
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
    const h = HEADERS.find((k) =>
      (HEADER_LABELS[k] as readonly string[]).some((l) => nfc(l) === label),
    );
    if (h && !col.has(h)) col.set(h, colNumber);
  });
  const missing = HEADERS.filter((h) => !col.has(h));
  if (missing.length) {
    throw new StaffUploadParseError(`Missing required columns: ${missing.join(', ')}`);
  }

  // ponytail: the sheet is already in memory here; a streaming reader would cap a zip bomb.
  if (ws.actualRowCount - 1 > MAX_DATA_ROWS) {
    throw new StaffUploadParseError(`File has too many rows (max ${MAX_DATA_ROWS})`);
  }
  const rows: StaffParsedRow[] = [];
  for (let rowNumber = 2; rowNumber <= ws.rowCount; rowNumber++) {
    const row = ws.getRow(rowNumber);
    const values = {} as Record<StaffHeader, string>;
    for (const h of HEADERS) values[h] = cellToString(row.getCell(col.get(h) as number).value);
    if (HEADERS.every((h) => values[h] === '')) continue;
    const numericMobile = typeof row.getCell(col.get('mobile') as number).value === 'number';
    // Spaces, dots, dashes and brackets are not part of the identifier.
    values.mobile = normalizeDigits(values.mobile).replace(/[\s().-]/g, '');
    rows.push({ rowNumber, values, numericMobile });
  }

  if (rows.length === 0) throw new StaffUploadParseError('File contains no data rows');
  if (rows.length > MAX_DATA_ROWS) {
    throw new StaffUploadParseError(`File has too many rows (max ${MAX_DATA_ROWS})`);
  }
  return rows;
}
