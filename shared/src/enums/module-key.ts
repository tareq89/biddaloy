import { EntityLabel } from './entity-label';
import { UserRole } from './index';

/** Switchable modules (Epic 77 D46). Everything in CORE_AREAS is never off. */
export const ModuleKey = {
  attendance: 'attendance',
  staffAttendance: 'staffAttendance',
  fees: 'fees',
  fines: 'fines',
  exams: 'exams',
  seatPlans: 'seatPlans',
  evaluations: 'evaluations',
  homework: 'homework',
  syllabus: 'syllabus',
  studyPlans: 'studyPlans',
  routines: 'routines',
  programs: 'programs',
  admission: 'admission',
  applications: 'applications',
  notices: 'notices',
  messaging: 'messaging',
  website: 'website',
} as const;
export type ModuleKey = (typeof ModuleKey)[keyof typeof ModuleKey];

/** Areas that can never be switched off (D6, D46). Used by drift tests. */
export const CORE_AREAS = [
  'dashboard',
  'students',
  'guardians',
  'staff',
  'classes',
  'academicYears',
  'teachingAssignments',
  'settings',
  'roles',
  'auditLogs',
  'reports',
  'calendar',
  'documents',
] as const;

/** dependant -> base (D38). Base off turns the dependant off. */
export const MODULE_DEPENDENCIES: Partial<Record<ModuleKey, ModuleKey>> = {
  fines: ModuleKey.fees,
  seatPlans: ModuleKey.exams,
  studyPlans: ModuleKey.routines,
};

export interface SchoolModuleEntry {
  on?: boolean;
  offForRoles?: UserRole[];
  lock?: 'on' | 'off';
}
export type SchoolModules = Partial<Record<ModuleKey, SchoolModuleEntry>>;
export type PlatformModules = Partial<Record<ModuleKey, boolean>>;

export interface LabelEntry {
  en?: { one?: string; other?: string };
  bn?: string;
}
/** shift/version/group live on TenantSettings.organisation (D17). */
export type LabelKey = Exclude<EntityLabel, 'shift' | 'version' | 'group'>;
export type SchoolLabels = Partial<Record<LabelKey, LabelEntry>>;

export type ModuleSource =
  'platform-off' | 'platform-lock' | 'dependency' | 'school' | 'role' | 'default';
export interface ModuleState {
  on: boolean;
  source: ModuleSource;
  dependsOn?: ModuleKey;
}
export interface ModuleInput {
  platform?: PlatformModules | null;
  school?: SchoolModules | null;
  role?: UserRole | null;
}

/**
 * Precedence: platform off > dependency > platform lock > school choice >
 * role-off > default on (D7, D38, D11, D12, D40). Dependency sits above the
 * lock so a locked-on dependant never shows without its base.
 * ADMIN and SUPER_ADMIN are never role-off.
 */
export function resolveModuleState(input: ModuleInput, key: ModuleKey): ModuleState {
  const { platform, school, role } = input;
  if (platform?.[key] === false) return { on: false, source: 'platform-off' };
  const base = MODULE_DEPENDENCIES[key];
  if (base && !resolveModuleState(input, base).on) {
    return { on: false, source: 'dependency', dependsOn: base };
  }
  const entry = school?.[key];
  if (entry?.lock) return { on: entry.lock === 'on', source: 'platform-lock' };
  if (entry?.on === false) return { on: false, source: 'school' };
  if (
    role &&
    role !== UserRole.ADMIN &&
    role !== UserRole.SUPER_ADMIN &&
    entry?.offForRoles?.includes(role)
  ) {
    return { on: false, source: 'role' };
  }
  return { on: true, source: entry?.on === true ? 'school' : 'default' };
}

export const moduleEnabled = (input: ModuleInput, key: ModuleKey): boolean =>
  resolveModuleState(input, key).on;

/** Words an admin can pick from when renaming (D18). */
export const LABEL_SUGGESTIONS: Partial<Record<LabelKey, LabelEntry[]>> = {
  class: [{ en: { one: 'Course', other: 'Courses' }, bn: 'কোর্স' }],
  section: [{ en: { one: 'Batch', other: 'Batches' }, bn: 'ব্যাচ' }],
  student: [{ en: { one: 'Trainee', other: 'Trainees' }, bn: 'প্রশিক্ষণার্থী' }],
  guardian: [{ en: { one: 'Sponsor', other: 'Sponsors' }, bn: 'স্পন্সর' }],
  teacher: [{ en: { one: 'Instructor', other: 'Instructors' }, bn: 'প্রশিক্ষক' }],
};
