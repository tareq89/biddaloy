// [99.1.01] Login as + support access (Epic 99).

export enum ImpersonationStatus {
  REQUESTED = 'REQUESTED',
  APPROVED = 'APPROVED',
  ACTIVE = 'ACTIVE',
  ENDED = 'ENDED',
  EXPIRED = 'EXPIRED',
  DENIED = 'DENIED',
}

/** The school's own choice on who may open Login as (D1). */
export enum SupportAccessMode {
  ALLOWED = 'allowed',
  ASK = 'ask',
  BLOCKED = 'blocked',
}

export enum ImpersonationEntryKind {
  NORMAL = 'NORMAL',
  EMERGENCY = 'EMERGENCY',
}

export enum ImpersonationEndedBy {
  OWNER = 'OWNER',
  PERSON_TAB = 'PERSON_TAB',
  SCHOOL_ADMIN = 'SCHOOL_ADMIN',
  REPLACED = 'REPLACED',
  EXPIRED = 'EXPIRED',
  MODE_BLOCKED = 'MODE_BLOCKED',
  LOCKED = 'LOCKED',
}
