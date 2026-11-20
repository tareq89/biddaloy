/** [59.1.01] Legal documents a school admin accepts, and photo-consent values. */
export enum LegalDocument {
  TERMS = 'terms',
  PRIVACY = 'privacy',
  DPA = 'dpa',
  SLA = 'sla',
}

/**
 * Current version of each document. Bumping a version makes admins re-accept it at their
 * next sign-in (D15).
 */
export const LEGAL_DOCS: Record<LegalDocument, { version: string }> = {
  [LegalDocument.TERMS]: { version: '1.0' },
  [LegalDocument.PRIVACY]: { version: '1.0' },
  [LegalDocument.DPA]: { version: '1.0' },
  [LegalDocument.SLA]: { version: '1.0' },
};

/** Documents every school admin must have accepted (D7, D31). */
export const ADMIN_REQUIRED_DOCS = [
  LegalDocument.TERMS,
  LegalDocument.PRIVACY,
  LegalDocument.DPA,
] as const;

/** Documents accepted at signup: the same list as the admin gate. */
export const SIGNUP_DOCS = ADMIN_REQUIRED_DOCS;

/** Whether a guardian allows the school to use the student's photo (D8, D25). */
export enum PhotoConsent {
  GIVEN = 'GIVEN',
  REFUSED = 'REFUSED',
  UNKNOWN = 'UNKNOWN',
}
