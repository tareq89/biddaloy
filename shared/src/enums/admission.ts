/**
 * [27.1] Admission-intake enums. Const-object + type pattern (not TS
 * `enum`), matching `homework.ts`/`exams.ts`.
 */

/** An applicant's place in the admission review pipeline. */
export const AdmissionApplicantStatus = {
  PENDING: 'PENDING',
  SHORTLISTED: 'SHORTLISTED',
  ADMITTED: 'ADMITTED',
  REJECTED: 'REJECTED',
  FEE_PENDING: 'FEE_PENDING',
  OFFERED: 'OFFERED',
  WAITING: 'WAITING',
  EXPIRED: 'EXPIRED',
} as const;
export type AdmissionApplicantStatus =
  (typeof AdmissionApplicantStatus)[keyof typeof AdmissionApplicantStatus];

/** Kind of document an admission intake can require from an applicant. */
export const AdmissionDocumentType = {
  PHOTO: 'PHOTO',
  BIRTH_CERTIFICATE: 'BIRTH_CERTIFICATE',
  TRANSCRIPT: 'TRANSCRIPT',
  SSC_MARKSHEET: 'SSC_MARKSHEET',
  TRANSFER_CERTIFICATE: 'TRANSFER_CERTIFICATE',
  QUOTA_CERTIFICATE: 'QUOTA_CERTIFICATE',
} as const;
export type AdmissionDocumentType =
  (typeof AdmissionDocumentType)[keyof typeof AdmissionDocumentType];

/** [Epic 71 D1] What one admission stage is. */
export const AdmissionStageKind = {
  NONE: 'NONE',
  WRITTEN: 'WRITTEN',
  VIVA: 'VIVA',
  LOTTERY: 'LOTTERY',
  FIRST_COME: 'FIRST_COME',
  GPA: 'GPA',
} as const;
export type AdmissionStageKind = (typeof AdmissionStageKind)[keyof typeof AdmissionStageKind];

/** [Epic 71 D3] Which result list. */
export const AdmissionListKind = {
  MERIT: 'MERIT',
  WAITING: 'WAITING',
} as const;
export type AdmissionListKind = (typeof AdmissionListKind)[keyof typeof AdmissionListKind];

/** [Epic 71 D3] How a list is ordered; the admin picks one per list. */
export const AdmissionListOrder = {
  MERIT: 'MERIT',
  FIRST_COME: 'FIRST_COME',
  MANUAL: 'MANUAL',
  FILTER: 'FILTER',
} as const;
export type AdmissionListOrder = (typeof AdmissionListOrder)[keyof typeof AdmissionListOrder];

/** [Epic 71] Where an application came from. */
export const AdmissionSource = {
  ONLINE: 'ONLINE',
  CLERK: 'CLERK',
} as const;
export type AdmissionSource = (typeof AdmissionSource)[keyof typeof AdmissionSource];

/** [Epic 71 D9] Manual fee-proof state. */
export const AdmissionFeeState = {
  NONE: 'NONE',
  AWAITING: 'AWAITING',
  CONFIRMED: 'CONFIRMED',
  SENT_BACK: 'SENT_BACK',
} as const;
export type AdmissionFeeState = (typeof AdmissionFeeState)[keyof typeof AdmissionFeeState];

/** [Epic 71 D9] Fee-proof payment method. */
export const AdmissionPayMethod = {
  BKASH: 'BKASH',
  NAGAD: 'NAGAD',
  ROCKET: 'ROCKET',
  BANK: 'BANK',
} as const;
export type AdmissionPayMethod = (typeof AdmissionPayMethod)[keyof typeof AdmissionPayMethod];

/** [Epic 71 D20] Round templates. */
export const AdmissionTemplateKey = {
  APPLY_ONLY: 'APPLY_ONLY',
  WRITTEN: 'WRITTEN',
  WRITTEN_VIVA: 'WRITTEN_VIVA',
  LOTTERY: 'LOTTERY',
  FIRST_COME: 'FIRST_COME',
  GPA_MERIT: 'GPA_MERIT',
} as const;
export type AdmissionTemplateKey = (typeof AdmissionTemplateKey)[keyof typeof AdmissionTemplateKey];
