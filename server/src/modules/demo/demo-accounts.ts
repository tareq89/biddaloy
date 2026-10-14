/**
 * The single list of demo logins. The W2 seed slices create exactly these users and the
 * login screen shows exactly these cards, so this file is the contract between them
 * (like `e2e/seed-contract.ts` is for the dev seed). Nothing else may hard-code a demo email.
 */
export const DEMO_SCHOOL_SLUGS = ['bmsc-primary', 'bmsc-high', 'bmsc-college'] as const;

export interface DemoCard {
  key: string;
  /** A `UserRole` value; EXECUTIVE is the principal. */
  role: string;
  email: string;
  /** Branch (school slug) the card lands in after login. */
  branchSlug: (typeof DEMO_SCHOOL_SLUGS)[number];
  nameEn: string;
  nameBn: string;
  /** Feature the UI points the visitor to first. */
  tryKey: string;
}

const HIGH = 'bmsc-high' as const;

export const DEMO_CARDS: readonly DemoCard[] = [
  {
    key: 'admin',
    role: 'ADMIN',
    email: 'admin@bmsc.example',
    branchSlug: HIGH,
    nameEn: 'Admin (all three branches)',
    nameBn: 'অ্যাডমিন (তিনটি শাখা)',
    tryKey: 'dashboard',
  },
  {
    key: 'principal',
    role: 'EXECUTIVE',
    email: 'principal@bmsc.example',
    branchSlug: HIGH,
    nameEn: 'Principal',
    nameBn: 'অধ্যক্ষ',
    tryKey: 'overview',
  },
  {
    key: 'accountant',
    role: 'ACCOUNTANT',
    email: 'accountant@bmsc.example',
    branchSlug: HIGH,
    nameEn: 'Accountant',
    nameBn: 'হিসাবরক্ষক',
    tryKey: 'fees',
  },
  {
    key: 'class-teacher-8a',
    role: 'TEACHER',
    email: 'teacher8a@bmsc.example',
    branchSlug: HIGH,
    nameEn: 'Class teacher, Class 8-A',
    nameBn: 'শ্রেণি শিক্ষক, অষ্টম-ক',
    tryKey: 'attendance',
  },
  {
    key: 'exam-controller',
    role: 'EXAM_CONTROLLER',
    email: 'exams@bmsc.example',
    branchSlug: HIGH,
    nameEn: 'Exam controller',
    nameBn: 'পরীক্ষা নিয়ন্ত্রক',
    tryKey: 'exams',
  },
  {
    key: 'office-staff',
    role: 'OFFICE_STAFF',
    email: 'office@bmsc.example',
    branchSlug: HIGH,
    nameEn: 'Office staff',
    nameBn: 'অফিস কর্মী',
    tryKey: 'students',
  },
  {
    key: 'committee',
    role: 'COMMITTEE',
    email: 'committee@bmsc.example',
    branchSlug: HIGH,
    nameEn: 'Governing committee member',
    nameBn: 'পরিচালনা কমিটির সদস্য',
    tryKey: 'overview',
  },
  {
    key: 'guardian',
    role: 'PARENT',
    email: 'guardian@bmsc.example',
    branchSlug: HIGH,
    nameEn: 'Guardian (two children, one in Primary)',
    nameBn: 'অভিভাবক (দুই সন্তান, একজন প্রাথমিকে)',
    tryKey: 'children',
  },
  {
    key: 'student-9b',
    role: 'STUDENT',
    email: 'student9b@bmsc.example',
    branchSlug: HIGH,
    nameEn: 'Student, Class 9-B',
    nameBn: 'শিক্ষার্থী, নবম-খ',
    tryKey: 'homework',
  },
];
