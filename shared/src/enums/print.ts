/**
 * Epic 32.0 print-module enums. Const-object + type pattern (not TS `enum`),
 * matching `seat-plan.ts`. `DocumentKind` is stored as varchar (D39) so later
 * epics can add kinds without a migration.
 */

export const DocumentKind = {
  STUDENT_ID_CARD: 'STUDENT_ID_CARD',
  STAFF_ID_CARD: 'STAFF_ID_CARD',
  ACR_ASSESSMENT: 'ACR_ASSESSMENT',
  EXAM_ADMIT_CARD: 'EXAM_ADMIT_CARD',
  TRANSFER_CERTIFICATE: 'TRANSFER_CERTIFICATE',
  TESTIMONIAL: 'TESTIMONIAL',
  CHARACTER_CERTIFICATE: 'CHARACTER_CERTIFICATE',
  STUDY_CERTIFICATE: 'STUDY_CERTIFICATE',
  PARTICIPATION_CERTIFICATE: 'PARTICIPATION_CERTIFICATE',
  RESULT_CERTIFICATE: 'RESULT_CERTIFICATE',
  MERIT_CERTIFICATE: 'MERIT_CERTIFICATE',
} as const;
export type DocumentKind = (typeof DocumentKind)[keyof typeof DocumentKind];

export const LayoutKind = { FIXED: 'FIXED', FLOWING: 'FLOWING' } as const;
export type LayoutKind = (typeof LayoutKind)[keyof typeof LayoutKind];

export const PrintElementType = {
  TEXT: 'TEXT',
  IMAGE: 'IMAGE',
  QR: 'QR',
  SHAPE: 'SHAPE',
} as const;
export type PrintElementType = (typeof PrintElementType)[keyof typeof PrintElementType];

export const ShapeKind = { RECT: 'RECT', LINE: 'LINE' } as const;
export type ShapeKind = (typeof ShapeKind)[keyof typeof ShapeKind];

export const OverflowPolicy = {
  SHRINK: 'SHRINK',
  WRAP: 'WRAP',
  CLIP: 'CLIP',
  FLAG: 'FLAG',
} as const;
export type OverflowPolicy = (typeof OverflowPolicy)[keyof typeof OverflowPolicy];

export const ImageFit = { COVER: 'COVER', CONTAIN: 'CONTAIN' } as const;
export type ImageFit = (typeof ImageFit)[keyof typeof ImageFit];

export const PrinterType = { CARD: 'CARD', OFFICE: 'OFFICE' } as const;
export type PrinterType = (typeof PrinterType)[keyof typeof PrinterType];

export const DuplexOrder = { INTERLEAVED: 'INTERLEAVED', GROUPED: 'GROUPED' } as const;
export type DuplexOrder = (typeof DuplexOrder)[keyof typeof DuplexOrder];

export const PrintAssetKind = { ARTWORK: 'ARTWORK', IMAGE: 'IMAGE', FONT: 'FONT' } as const;
export type PrintAssetKind = (typeof PrintAssetKind)[keyof typeof PrintAssetKind];

export const PrintJobStatus = { OPEN: 'OPEN', CONFIRMED: 'CONFIRMED' } as const;
export type PrintJobStatus = (typeof PrintJobStatus)[keyof typeof PrintJobStatus];

export const PrintItemOutcome = { PENDING: 'PENDING', OK: 'OK', FAILED: 'FAILED' } as const;
export type PrintItemOutcome = (typeof PrintItemOutcome)[keyof typeof PrintItemOutcome];

export const PrintSubjectType = { STUDENT: 'STUDENT', STAFF: 'STAFF', ACR: 'ACR' } as const;
export type PrintSubjectType = (typeof PrintSubjectType)[keyof typeof PrintSubjectType];

/** Hard cap on items in one print job (D46). */
export const PRINT_BATCH_CEILING = 200;
/** Default chunk size when a job is split into batches (D46). */
export const PRINT_DEFAULT_BATCH_SIZE = 50;
/** ISO CR80 card size in millimetres. */
export const CR80 = { widthMm: 85.6, heightMm: 54 } as const;

/** Fixed criterion slots an ACR template can bind (`acr.criterion.N.*`); a form with more is refused. */
export const ACR_CRITERIA_SLOTS = 30;

/** Fixed sitting slots an admit-card template can bind (`exam.sitting.N.*`, D28). */
export const ADMIT_CARD_SITTING_SLOTS = 15;

/** What a document kind is printed for, besides a student/staff subject. */
export const PrintContextType = { EXAM: 'EXAM' } as const;
export type PrintContextType = (typeof PrintContextType)[keyof typeof PrintContextType];

export const KIND_CONTEXT: Partial<Record<DocumentKind, PrintContextType>> = {
  [DocumentKind.EXAM_ADMIT_CARD]: PrintContextType.EXAM,
  [DocumentKind.RESULT_CERTIFICATE]: PrintContextType.EXAM,
  [DocumentKind.MERIT_CERTIFICATE]: PrintContextType.EXAM,
};

/** Kinds that get a `<CODE>-<YYYY>-<NNNNN>` serial (D7, D24). */
export const CERTIFICATE_SERIAL_CODE: Partial<Record<DocumentKind, string>> = {
  [DocumentKind.TRANSFER_CERTIFICATE]: 'TC',
  [DocumentKind.TESTIMONIAL]: 'TSM',
  [DocumentKind.CHARACTER_CERTIFICATE]: 'CHR',
  [DocumentKind.STUDY_CERTIFICATE]: 'STD',
  [DocumentKind.PARTICIPATION_CERTIFICATE]: 'PRT',
  [DocumentKind.RESULT_CERTIFICATE]: 'RES',
  [DocumentKind.MERIT_CERTIFICATE]: 'MRT',
};
export const isSerialKind = (kind: DocumentKind): boolean => kind in CERTIFICATE_SERIAL_CODE;

/** Kinds that need `CERTIFICATE_ISSUE` (D6). Result/merit are exam documents and stay on DOCUMENT_PRINT. */
export const STUDENT_CERTIFICATE_KINDS = [
  DocumentKind.TRANSFER_CERTIFICATE,
  DocumentKind.TESTIMONIAL,
  DocumentKind.CHARACTER_CERTIFICATE,
  DocumentKind.STUDY_CERTIFICATE,
  DocumentKind.PARTICIPATION_CERTIFICATE,
] as const;
export type StudentCertificateKind = (typeof STUDENT_CERTIFICATE_KINDS)[number];
export const isStudentCertificateKind = (kind: DocumentKind): kind is StudentCertificateKind =>
  (STUDENT_CERTIFICATE_KINDS as readonly string[]).includes(kind);

/** Optional school short code in front of a serial (D24). */
export const SERIAL_PREFIX_PATTERN = /^[A-Z0-9]{2,8}$/;

/** `DAHS-TC-2026-00007`, or `TSM-2026-00009` without a prefix. */
export function formatSerial(a: {
  prefix?: string | undefined;
  kind: DocumentKind;
  year: number;
  n: number;
}): string {
  const code = CERTIFICATE_SERIAL_CODE[a.kind];
  if (!code) throw new RangeError(`${a.kind} has no serial code`);
  if (!Number.isInteger(a.n) || a.n < 1 || a.n > 99999) {
    throw new RangeError(`serial number out of range: ${a.n}`);
  }
  const num = String(a.n).padStart(5, '0');
  return [a.prefix, code, a.year, num].filter((x) => x !== undefined && x !== '').join('-');
}
