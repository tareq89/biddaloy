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
} as const;
export type AdmissionApplicantStatus =
  (typeof AdmissionApplicantStatus)[keyof typeof AdmissionApplicantStatus];

/** Kind of document an admission intake can require from an applicant. */
export const AdmissionDocumentType = {
  PHOTO: 'PHOTO',
  BIRTH_CERTIFICATE: 'BIRTH_CERTIFICATE',
  TRANSCRIPT: 'TRANSCRIPT',
} as const;
export type AdmissionDocumentType =
  (typeof AdmissionDocumentType)[keyof typeof AdmissionDocumentType];
