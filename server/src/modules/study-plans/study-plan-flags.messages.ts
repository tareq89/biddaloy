/** [66.2.05/#2010] Bangla push/SMS strings (D35: "পাঠ পরিকল্পনা", never "প্ল্যান"). Numbers use Bangla digits. */

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';

/** `12` -> `১২`. Any non-digit character passes through. */
export const toBn = (v: number | string): string =>
  String(v).replace(/\d/g, (d) => BN_DIGITS[Number(d)]);

export const FLAG_URLS = {
  teacher: '/routines/my',
  escalation: '/academics/syllabus?tab=plans',
  guardian: (studentId: string) => `/portal/syllabus?student=${studentId}`,
  committee: '/academics/syllabus?tab=plans',
} as const;

export const FLAG_TITLES = {
  reminder: 'পাঠের অবস্থা জানানো হয়নি',
  escalation: 'শিক্ষকদের পাঠের অবস্থা বাকি',
  guardian: 'পাঠ পরিকল্পনা',
  committee: 'পাঠ পরিকল্পনার সারসংক্ষেপ',
} as const;

export const teacherReminderBody = (periods: number): string =>
  `গতকালের ${toBn(periods)}টি পিরিয়ডের পাঠ পরিকল্পনার অবস্থা জানানো হয়নি`;

export const escalationBody = (teachers: number, schoolDays: number): string =>
  `${toBn(teachers)} জন শিক্ষক ${toBn(schoolDays)} কর্মদিবস ধরে পাঠের অবস্থা জানাননি`;

export const guardianBody = (
  child: string,
  section: string,
  behind: { subject: string; periods: number }[],
): string =>
  `${child} (${toBn(section)}): ${behind
    .map((b) => `${b.subject} ${toBn(b.periods)} পিরিয়ড পিছিয়ে`)
    .join(', ')}`;

export const committeeLine = (className: string, total: number, behind: number): string =>
  `${toBn(className)}: ${toBn(total)}টি পাঠ পরিকল্পনার ${toBn(behind)}টি পিছিয়ে`;
