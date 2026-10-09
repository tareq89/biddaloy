// [52.1.1] Applications — enums and the type catalogue (Epic 52).
// Not re-exported from enums/index.ts: that would be a circular value import
// (see student-lifecycle.ts); it is exported from shared/src/index.ts.
import { UserRole } from './index';
import { Permission } from './permissions';

export enum ApplicationType {
  STAFF_LEAVE = 'STAFF_LEAVE',
  STUDENT_LEAVE = 'STUDENT_LEAVE',
  FEE_WAIVER = 'FEE_WAIVER',
  TESTIMONIAL = 'TESTIMONIAL',
  TRANSFER_CERTIFICATE = 'TRANSFER_CERTIFICATE',
  READMISSION = 'READMISSION',
  SECTION_CHANGE = 'SECTION_CHANGE',
  SCRIPT_RECHECK = 'SCRIPT_RECHECK',
  ID_CARD_REPRINT = 'ID_CARD_REPRINT',
  GENERAL = 'GENERAL',
}

export enum ApplicationStatus {
  PENDING = 'PENDING',
  /** D15: any decider may park it; the step does not advance. */
  UNDER_CONSIDERATION = 'UNDER_CONSIDERATION',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  WITHDRAWN = 'WITHDRAWN',
  /** D31: approved leave only. */
  CANCELLED = 'CANCELLED',
}

export enum ApplicationSource {
  APP = 'APP',
  PAPER = 'PAPER',
}

export enum ApplicationEventKind {
  SUBMITTED = 'SUBMITTED',
  /** A non-final step approved; the application moves to the next step. */
  STEP_APPROVED = 'STEP_APPROVED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  UNDER_CONSIDERATION = 'UNDER_CONSIDERATION',
  WITHDRAWN = 'WITHDRAWN',
  CANCELLED = 'CANCELLED',
  COMMENT = 'COMMENT',
  TAGGED = 'TAGGED',
}

/** D30 */
export enum StudentLeaveReason {
  SICK = 'SICK',
  FAMILY = 'FAMILY',
  OTHER = 'OTHER',
}

export enum ApplicationAddressee {
  CLASS_TEACHER = 'CLASS_TEACHER',
  HEADMASTER = 'HEADMASTER',
  OFFICE = 'OFFICE',
  STAFF_USER = 'STAFF_USER',
}

export enum ApplicationSubjectKind {
  STUDENT = 'STUDENT',
  STAFF = 'STAFF',
}

export type ApplicationStep =
  | { kind: 'CLASS_TEACHER' }
  | { kind: 'ROLES'; roles: UserRole[] }
  | { kind: 'PERMISSION'; permission: Permission }
  | { kind: 'ADDRESSEE' };

/** D7 */
export const APPLICATION_OVERRIDE_ROLES = [UserRole.ADMIN, UserRole.EXECUTIVE] as const;

/** D10 */
export const ATTACHMENT_LIMITS = {
  maxFiles: 3,
  maxBytes: 5 * 1024 * 1024,
  mime: ['application/pdf', 'image/jpeg', 'image/png'],
} as const;

export interface ApplicationTypeDef {
  subject: readonly ApplicationSubjectKind[];
  steps: ApplicationStep[];
  effect: 'AUTO' | 'MANUAL' | 'NONE';
  effectPermission?: Permission;
  bulkApprovable: boolean;
  cancellable: boolean;
}

const S = ApplicationSubjectKind;

/**
 * A CLASS_TEACHER step is skipped when the subject has no section class teacher or is staff (D37);
 * override roles may decide any step (D7), but a final AUTO approval also needs `effectPermission`.
 */
export const APPLICATION_TYPES: Record<ApplicationType, ApplicationTypeDef> = {
  [ApplicationType.STAFF_LEAVE]: {
    subject: [S.STAFF],
    steps: [{ kind: 'PERMISSION', permission: Permission.LEAVE_APPROVE }],
    effect: 'AUTO',
    effectPermission: Permission.LEAVE_APPROVE,
    bulkApprovable: true,
    cancellable: true,
  },
  [ApplicationType.STUDENT_LEAVE]: {
    subject: [S.STUDENT],
    steps: [{ kind: 'CLASS_TEACHER' }],
    effect: 'AUTO', // D44: no effectPermission
    bulkApprovable: true,
    cancellable: true,
  },
  [ApplicationType.FEE_WAIVER]: {
    subject: [S.STUDENT],
    steps: [
      { kind: 'CLASS_TEACHER' },
      { kind: 'PERMISSION', permission: Permission.DISCOUNT_RULE_MANAGE },
    ],
    effect: 'AUTO',
    effectPermission: Permission.DISCOUNT_RULE_MANAGE,
    bulkApprovable: false,
    cancellable: false,
  },
  [ApplicationType.TESTIMONIAL]: {
    subject: [S.STUDENT],
    steps: [{ kind: 'CLASS_TEACHER' }, { kind: 'ROLES', roles: [UserRole.ADMIN] }],
    effect: 'MANUAL',
    bulkApprovable: true,
    cancellable: false,
  },
  [ApplicationType.TRANSFER_CERTIFICATE]: {
    subject: [S.STUDENT],
    steps: [
      { kind: 'CLASS_TEACHER' },
      { kind: 'PERMISSION', permission: Permission.STUDENT_LIFECYCLE_MANAGE },
    ],
    effect: 'AUTO',
    effectPermission: Permission.STUDENT_LIFECYCLE_MANAGE,
    bulkApprovable: true,
    cancellable: false,
  },
  [ApplicationType.READMISSION]: {
    subject: [S.STUDENT],
    steps: [{ kind: 'PERMISSION', permission: Permission.STUDENT_LIFECYCLE_MANAGE }],
    effect: 'AUTO',
    effectPermission: Permission.STUDENT_LIFECYCLE_MANAGE,
    bulkApprovable: true,
    cancellable: false,
  },
  [ApplicationType.SECTION_CHANGE]: {
    subject: [S.STUDENT],
    steps: [{ kind: 'CLASS_TEACHER' }, { kind: 'ROLES', roles: [UserRole.ADMIN] }],
    effect: 'AUTO',
    effectPermission: Permission.STUDENT_UPDATE,
    bulkApprovable: true,
    cancellable: false,
  },
  [ApplicationType.SCRIPT_RECHECK]: {
    subject: [S.STUDENT],
    steps: [{ kind: 'CLASS_TEACHER' }, { kind: 'ROLES', roles: [UserRole.EXAM_CONTROLLER] }],
    effect: 'MANUAL',
    bulkApprovable: true,
    cancellable: false,
  },
  [ApplicationType.ID_CARD_REPRINT]: {
    subject: [S.STUDENT, S.STAFF],
    steps: [{ kind: 'ROLES', roles: [UserRole.OFFICE_STAFF, UserRole.ADMIN] }],
    effect: 'MANUAL',
    bulkApprovable: true,
    cancellable: false,
  },
  [ApplicationType.GENERAL]: {
    subject: [S.STUDENT, S.STAFF],
    steps: [{ kind: 'ADDRESSEE' }],
    effect: 'NONE',
    bulkApprovable: true,
    cancellable: false,
  },
};
