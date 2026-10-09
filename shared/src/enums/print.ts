/**
 * Epic 32.0 print-module enums. Const-object + type pattern (not TS `enum`),
 * matching `seat-plan.ts`. `DocumentKind` is stored as varchar (D39) so later
 * epics can add kinds without a migration.
 */

export const DocumentKind = {
  STUDENT_ID_CARD: 'STUDENT_ID_CARD',
  STAFF_ID_CARD: 'STAFF_ID_CARD',
  ACR_ASSESSMENT: 'ACR_ASSESSMENT',
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
