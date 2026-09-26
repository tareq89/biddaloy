// [8.5.3] Locale-proof accessible-name lookups: specs resolve strings
// through the app's own message catalogs (`ui/src/i18n/locales`) instead
// of hardcoding Bangla. Default locale is `bn` — what a fresh browser
// context renders (ui/src/i18n/locale-storage.ts) — switchable per suite
// for future en coverage.
//
// Deliberately not react-i18next: specs need plain string lookup +
// `{{var}}` interpolation, nothing more.

import bnAcademicYears from '../ui/src/i18n/locales/bn/academicYears.json';
import bnApproval from '../ui/src/i18n/locales/bn/approval.json';
import bnAttendance from '../ui/src/i18n/locales/bn/attendance.json';
import bnAuth from '../ui/src/i18n/locales/bn/auth.json';
import bnBackup from '../ui/src/i18n/locales/bn/backup.json';
import bnBulkImport from '../ui/src/i18n/locales/bn/bulkImport.json';
import bnCalendar from '../ui/src/i18n/locales/bn/calendar.json';
import bnClasses from '../ui/src/i18n/locales/bn/classes.json';
import bnCommon from '../ui/src/i18n/locales/bn/common.json';
import bnCommunications from '../ui/src/i18n/locales/bn/communications.json';
import bnExams from '../ui/src/i18n/locales/bn/exams.json';
import bnFeeGeneration from '../ui/src/i18n/locales/bn/feeGeneration.json';
import bnFees from '../ui/src/i18n/locales/bn/fees.json';
import bnFeeStructures from '../ui/src/i18n/locales/bn/feeStructures.json';
import bnGrading from '../ui/src/i18n/locales/bn/grading.json';
import bnGuardians from '../ui/src/i18n/locales/bn/guardians.json';
import bnHomework from '../ui/src/i18n/locales/bn/homework.json';
import bnNav from '../ui/src/i18n/locales/bn/nav.json';
import bnPayments from '../ui/src/i18n/locales/bn/payments.json';
import bnPlatform from '../ui/src/i18n/locales/bn/platform.json';
import bnPortal from '../ui/src/i18n/locales/bn/portal.json';
import bnPromotions from '../ui/src/i18n/locales/bn/promotions.json';
import bnReports from '../ui/src/i18n/locales/bn/reports.json';
import bnRoutines from '../ui/src/i18n/locales/bn/routines.json';
import bnSeatPlans from '../ui/src/i18n/locales/bn/seatPlans.json';
import bnSeatPlansDetail from '../ui/src/i18n/locales/bn/seatPlansDetail.json';
import bnSettings from '../ui/src/i18n/locales/bn/settings.json';
import bnStaff from '../ui/src/i18n/locales/bn/staff.json';
import bnStudents from '../ui/src/i18n/locales/bn/students.json';
import bnSyllabus from '../ui/src/i18n/locales/bn/syllabus.json';
import bnTeacherAssignments from '../ui/src/i18n/locales/bn/teacherAssignments.json';
import enAcademicYears from '../ui/src/i18n/locales/en/academicYears.json';
import enApproval from '../ui/src/i18n/locales/en/approval.json';
import enAttendance from '../ui/src/i18n/locales/en/attendance.json';
import enAuth from '../ui/src/i18n/locales/en/auth.json';
import enBackup from '../ui/src/i18n/locales/en/backup.json';
import enBulkImport from '../ui/src/i18n/locales/en/bulkImport.json';
import enCalendar from '../ui/src/i18n/locales/en/calendar.json';
import enClasses from '../ui/src/i18n/locales/en/classes.json';
import enCommon from '../ui/src/i18n/locales/en/common.json';
import enCommunications from '../ui/src/i18n/locales/en/communications.json';
import enExams from '../ui/src/i18n/locales/en/exams.json';
import enFeeGeneration from '../ui/src/i18n/locales/en/feeGeneration.json';
import enFees from '../ui/src/i18n/locales/en/fees.json';
import enFeeStructures from '../ui/src/i18n/locales/en/feeStructures.json';
import enGrading from '../ui/src/i18n/locales/en/grading.json';
import enGuardians from '../ui/src/i18n/locales/en/guardians.json';
import enHomework from '../ui/src/i18n/locales/en/homework.json';
import enNav from '../ui/src/i18n/locales/en/nav.json';
import enPayments from '../ui/src/i18n/locales/en/payments.json';
import enPlatform from '../ui/src/i18n/locales/en/platform.json';
import enPortal from '../ui/src/i18n/locales/en/portal.json';
import enPromotions from '../ui/src/i18n/locales/en/promotions.json';
import enReports from '../ui/src/i18n/locales/en/reports.json';
import enRoutines from '../ui/src/i18n/locales/en/routines.json';
import enSeatPlans from '../ui/src/i18n/locales/en/seatPlans.json';
import enSeatPlansDetail from '../ui/src/i18n/locales/en/seatPlansDetail.json';
import enSettings from '../ui/src/i18n/locales/en/settings.json';
import enStaff from '../ui/src/i18n/locales/en/staff.json';
import enStudents from '../ui/src/i18n/locales/en/students.json';
import enSyllabus from '../ui/src/i18n/locales/en/syllabus.json';
import enTeacherAssignments from '../ui/src/i18n/locales/en/teacherAssignments.json';

const catalogs = {
  bn: {
    academicYears: bnAcademicYears,
    approval: bnApproval,
    attendance: bnAttendance,
    auth: bnAuth,
    backup: bnBackup,
    bulkImport: bnBulkImport,
    calendar: bnCalendar,
    classes: bnClasses,
    common: bnCommon,
    communications: bnCommunications,
    exams: bnExams,
    feeGeneration: bnFeeGeneration,
    fees: bnFees,
    feeStructures: bnFeeStructures,
    grading: bnGrading,
    guardians: bnGuardians,
    homework: bnHomework,
    nav: bnNav,
    payments: bnPayments,
    platform: bnPlatform,
    portal: bnPortal,
    promotions: bnPromotions,
    reports: bnReports,
    routines: bnRoutines,
    seatPlans: bnSeatPlans,
    seatPlansDetail: bnSeatPlansDetail,
    settings: bnSettings,
    staff: bnStaff,
    students: bnStudents,
    syllabus: bnSyllabus,
    teacherAssignments: bnTeacherAssignments,
  },
  en: {
    academicYears: enAcademicYears,
    approval: enApproval,
    attendance: enAttendance,
    auth: enAuth,
    backup: enBackup,
    bulkImport: enBulkImport,
    calendar: enCalendar,
    classes: enClasses,
    common: enCommon,
    communications: enCommunications,
    exams: enExams,
    feeGeneration: enFeeGeneration,
    fees: enFees,
    feeStructures: enFeeStructures,
    grading: enGrading,
    guardians: enGuardians,
    homework: enHomework,
    nav: enNav,
    payments: enPayments,
    platform: enPlatform,
    portal: enPortal,
    promotions: enPromotions,
    reports: enReports,
    routines: enRoutines,
    seatPlans: enSeatPlans,
    seatPlansDetail: enSeatPlansDetail,
    settings: enSettings,
    staff: enStaff,
    students: enStudents,
    syllabus: enSyllabus,
    teacherAssignments: enTeacherAssignments,
  },
} as const;

export type Locale = keyof typeof catalogs;

/** Suite-wide default; `makeT('en')` for a suite that switches locale. */
export const DEFAULT_LOCALE: Locale = 'bn';

export function makeT(locale: Locale = DEFAULT_LOCALE) {
  return function t(key: string, params?: Record<string, string | number>): string {
    const [namespace, ...path] = key.split('.');
    let node: unknown = catalogs[locale][namespace as keyof (typeof catalogs)['bn']];
    for (const segment of path) {
      if (node === null || typeof node !== 'object') break;
      node = (node as Record<string, unknown>)[segment];
    }
    if (typeof node !== 'string') {
      throw new Error(`i18n key not found for locale "${locale}": ${key}`);
    }
    if (!params) return node;
    return node.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
      name in params ? String(params[name]) : match,
    );
  };
}

/** Default-locale translator — what nearly every spec should import. */
export const t = makeT();
