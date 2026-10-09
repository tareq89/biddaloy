/**
 * [39.1.1] Student-lifecycle enums. Const-object + type pattern, matching
 * `admission.ts`.
 */
// Type-only: `./index` re-exports this file, so a value import would be circular
// and `EnrollmentStatus` would be undefined at module load.
import type { EnrollmentStatus } from './index';

/** A change to a student's enrolment standing (D17). */
export const StudentLifecycleEventType = {
  WITHDRAWN: 'WITHDRAWN',
  TRANSFERRED_OUT: 'TRANSFERRED_OUT',
  GRADUATED: 'GRADUATED',
  READMITTED: 'READMITTED',
} as const;
export type StudentLifecycleEventType =
  (typeof StudentLifecycleEventType)[keyof typeof StudentLifecycleEventType];

/** Board/public exams a student's result can be recorded for (D21). */
export const PublicExamType = {
  PSC: 'PSC',
  JSC: 'JSC',
  SSC: 'SSC',
  DAKHIL: 'DAKHIL',
  HSC: 'HSC',
  ALIM: 'ALIM',
} as const;
export type PublicExamType = (typeof PublicExamType)[keyof typeof PublicExamType];

/** The `EnrollmentStatus` an enrolment moves to for each event type. */
export const LIFECYCLE_EVENT_TARGET_STATUS: Record<StudentLifecycleEventType, EnrollmentStatus> = {
  WITHDRAWN: 'INACTIVE' as EnrollmentStatus,
  TRANSFERRED_OUT: 'TRANSFERRED' as EnrollmentStatus,
  GRADUATED: 'GRADUATED' as EnrollmentStatus,
  READMITTED: 'ACTIVE' as EnrollmentStatus,
};
