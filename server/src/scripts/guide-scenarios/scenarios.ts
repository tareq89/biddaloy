import { createHash } from 'node:crypto';
import { FeeType, UserRole } from '@biddaloy/shared';
import { academicYears, type TenantKind } from '../demo-seed/dates';

/**
 * The starter workbooks the user guide's admin scenarios hand out (Epic 42.0, D5).
 * Everything here is fake: names say "Demo", phones run from 01700-000001,
 * emails end in @guide.example, and the year comes from the build date
 * (22-demo-seed.md safety rules; no literal dates).
 */

interface SectionSpec {
  name: string;
  group?: string;
}
interface ClassSpec {
  name: string;
  shift?: string;
  version?: string;
  sections: SectionSpec[];
}
export interface BranchSpec {
  /** File name without extension. */
  file: string;
  /** Prefix for registration numbers and emails; unique per branch (registration numbers are global). */
  code: string;
  kind: TenantKind;
  classes: ClassSpec[];
  subjects: Array<{ code: string; name_en: string; name_bn?: string }>;
  studentsPerSection: number;
}
export interface ScenarioSpec {
  slug: string;
  /** Pages must tell the reader to check these subjects with their board. */
  unverifiedSubjects: boolean;
  branches: BranchSpec[];
}

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);
const oneSection: SectionSpec[] = [{ name: 'A' }];
const GROUPS = ['Science', 'Commerce', 'Humanities'];

const GENERAL_SUBJECTS = [
  { code: 'BAN', name_en: 'Bangla', name_bn: 'বাংলা' },
  { code: 'ENG', name_en: 'English', name_bn: 'ইংরেজি' },
  { code: 'MATH', name_en: 'Mathematics', name_bn: 'গণিত' },
  { code: 'SCI', name_en: 'Science', name_bn: 'বিজ্ঞান' },
  { code: 'SOC', name_en: 'Bangladesh and Global Studies', name_bn: 'বাংলাদেশ ও বিশ্বপরিচয়' },
];

const highClasses: ClassSpec[] = range(6, 10).flatMap((n) =>
  ['Morning', 'Day'].flatMap((shift) =>
    ['Bangla', 'English'].map((version) => ({
      name: `Class ${n}`,
      shift,
      version,
      sections: oneSection,
    })),
  ),
);

const collegeBranch = (n: number): BranchSpec => ({
  file: `school-and-college-branch-${n}`,
  code: `SC${n}`,
  kind: 'COLLEGE',
  classes: range(9, 12).map((c) => ({
    name: `Class ${c}`,
    sections: GROUPS.map((g) => ({ name: g[0], group: g })),
  })),
  subjects: [
    ...GENERAL_SUBJECTS,
    { code: 'PHY', name_en: 'Physics', name_bn: 'পদার্থবিজ্ঞান' },
    { code: 'ACC', name_en: 'Accounting', name_bn: 'হিসাববিজ্ঞান' },
    { code: 'CIV', name_en: 'Civics', name_bn: 'পৌরনীতি' },
  ],
  studentsPerSection: 2,
});

export const SCENARIOS: ScenarioSpec[] = [
  {
    slug: 'primary-school',
    unverifiedSubjects: false,
    branches: [
      {
        file: 'primary-school',
        code: 'PR',
        kind: 'PRIMARY',
        classes: range(1, 5).map((n) => ({ name: `Class ${n}`, sections: oneSection })),
        subjects: GENERAL_SUBJECTS,
        studentsPerSection: 3,
      },
    ],
  },
  {
    slug: 'high-school-two-shifts',
    unverifiedSubjects: false,
    branches: [
      {
        file: 'high-school-two-shifts',
        code: 'HS',
        kind: 'HIGH',
        classes: highClasses,
        subjects: GENERAL_SUBJECTS,
        studentsPerSection: 2,
      },
    ],
  },
  { slug: 'school-and-college', unverifiedSubjects: false, branches: [1, 2, 3].map(collegeBranch) },
  {
    slug: 'nurani-madrasa',
    unverifiedSubjects: true,
    branches: [
      {
        file: 'nurani-madrasa',
        code: 'NM',
        kind: 'PRIMARY',
        classes: range(1, 5).map((n) => ({
          name: `Class ${n}`,
          shift: 'Morning',
          sections: oneSection,
        })),
        subjects: [
          { code: 'QUR', name_en: 'Quran Majeed and Tajweed', name_bn: 'কুরআন মজিদ ও তাজবীদ' },
          { code: 'AQF', name_en: 'Aqaid and Fiqh', name_bn: 'আকাইদ ও ফিকহ' },
          { code: 'ARB', name_en: 'Arabic', name_bn: 'আরবি' },
          { code: 'BAN', name_en: 'Bangla', name_bn: 'বাংলা' },
          { code: 'ENG', name_en: 'English', name_bn: 'ইংরেজি' },
          { code: 'MATH', name_en: 'Mathematics', name_bn: 'গণিত' },
        ],
        studentsPerSection: 3,
      },
    ],
  },
  {
    slug: 'cambridge-english-medium',
    unverifiedSubjects: true,
    branches: [
      {
        file: 'cambridge-english-medium',
        code: 'CB',
        kind: 'HIGH',
        classes: range(7, 11).map((n) => ({
          name: `Year ${n}`,
          version: 'English',
          sections: oneSection,
        })),
        subjects: [
          { code: 'ELANG', name_en: 'English Language' },
          { code: 'MATH', name_en: 'Mathematics' },
          { code: 'PHY', name_en: 'Physics' },
          { code: 'CHEM', name_en: 'Chemistry' },
          { code: 'BIO', name_en: 'Biology' },
          { code: 'ICT', name_en: 'Information and Communication Technology' },
        ],
        studentsPerSection: 2,
      },
    ],
  },
];

/** Stable v4-shaped uuid from a label (the codec only accepts v4), so a rebuild changes no id. */
export const stableId = (label: string): string => {
  const h = createHash('sha1').update(label).digest('hex');
  const variant = ((parseInt(h[16], 16) & 3) | 8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

/** Counts a restored branch must end with. */
export interface BranchCounts {
  classes: number;
  sections: number;
  students: number;
  feeStructures: number;
}

export function branchCounts(b: BranchSpec): BranchCounts {
  const sections = b.classes.reduce((n, c) => n + c.sections.length, 0);
  return {
    classes: b.classes.length,
    sections,
    students: sections * b.studentsPerSection,
    feeStructures: b.classes.length,
  };
}

export type TabRows = Record<string, Array<Record<string, unknown>>>;

/** The rows of every tab for one branch. `anchor` is today as YYYY-MM-DD. */
export function branchRows(b: BranchSpec, anchor: string): TabRows {
  const year = academicYears(b.kind, 1, anchor)[0];
  const rows: TabRows = {
    academic_years: [
      {
        id: stableId(`${b.file}|year`),
        name: year.name,
        start_date: year.start,
        end_date: year.end,
        is_current: true,
      },
    ],
    classes: [],
    sections: [],
    subjects: b.subjects.map((s) => ({
      id: stableId(`${b.file}|subject|${s.code}`),
      ...s,
      is_active: true,
    })),
    users: [
      [UserRole.TEACHER, 'Teacher'],
      [UserRole.ACCOUNTANT, 'Accountant'],
    ].map(([role, label]) => ({
      id: stableId(`${b.file}|user|${role}`),
      email: `${label.toLowerCase()}.${b.code.toLowerCase()}@guide.example`,
      full_name: `Demo ${label} ${b.code}`,
      role,
    })),
    guardians: [],
    students: [],
    fee_structures: [],
  };

  let studentNo = 0;
  for (const c of b.classes) {
    const classKey = `${c.name}|${year.name}|${c.shift ?? ''}|${c.version ?? ''}`;
    rows.classes.push({
      id: stableId(`${b.file}|class|${classKey}`),
      name: c.name,
      academic_year: year.name,
      shift: c.shift,
      version: c.version,
    });
    rows.fee_structures.push({
      id: stableId(`${b.file}|fee|${classKey}`),
      name: 'Monthly tuition',
      fee_type: FeeType.MONTHLY_TUITION,
      amount: '500.00',
      class: classKey,
      academic_year: year.name,
    });
    for (const s of c.sections) {
      const sectionKey = `${classKey}|${year.name}|${s.name}`;
      rows.sections.push({
        id: stableId(`${b.file}|section|${sectionKey}`),
        class: classKey,
        academic_year: year.name,
        section_name: s.name,
        group_name: s.group,
      });
      for (let roll = 1; roll <= b.studentsPerSection; roll++) {
        studentNo++;
        const phone = `01700${String(studentNo).padStart(6, '0')}`;
        const reg = `${b.code}-${String(studentNo).padStart(4, '0')}`;
        rows.guardians.push({
          id: stableId(`${b.file}|guardian|${phone}`),
          full_name: `Demo Guardian ${reg}`,
          relationship: 'Father',
          phone,
        });
        rows.students.push({
          id: stableId(`${b.file}|student|${reg}`),
          registration_number: reg,
          full_name: `Demo Student ${reg}`,
          roll_number: roll,
          class: classKey,
          academic_year: year.name,
          section: sectionKey,
          guardian_phones: [phone],
        });
      }
    }
  }
  return rows;
}
