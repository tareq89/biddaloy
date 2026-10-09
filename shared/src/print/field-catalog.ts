import { ACR_CRITERIA_SLOTS, DocumentKind } from '../enums/print';

export interface FieldDef {
  key: string;
  type: 'text' | 'image' | 'qr';
  /** i18n key for the field's label in the template designer. */
  labelKey: string;
  /** Preview value shown in the designer (a placeholder name for image fields). */
  sample: string;
  /** Worst-case value, used to check text overflow (D14). */
  longestSample?: string | undefined;
}

const f = (
  key: string,
  type: FieldDef['type'],
  sample: string,
  longestSample?: string,
): FieldDef => ({ key, type, labelKey: `print.field.${key}`, sample, longestSample });

const SCHOOL: FieldDef[] = [
  f(
    'school.name',
    'text',
    'Biddaloy High School',
    'Government Laboratory High School and College, Dhaka',
  ),
  f(
    'school.name_bn',
    'text',
    'বিদ্যালয় উচ্চ বিদ্যালয়',
    'সরকারি ল্যাবরেটরি উচ্চ বিদ্যালয় ও কলেজ, ঢাকা',
  ),
  f(
    'school.address',
    'text',
    '12 Green Road, Dhaka',
    '12/A Green Road, Dhanmondi, Dhaka-1205, Bangladesh',
  ),
  f('school.phone', 'text', '01711-000000'),
  f('school.logo', 'image', 'logo'),
];

const COMMON_TAIL: FieldDef[] = [
  f('card.valid_until', 'text', '31 Dec 2027'),
  f('print.copyLabel', 'text', 'Copy 2'),
  f('print.issue_date', 'text', '01 Jan 2027'),
  f('print.verify_qr', 'qr', 'https://example.com/verify/abc123'),
];

// No print.verify_qr and no photo: an ACR is confidential and must never be publicly verifiable.
const ACR_TAIL: FieldDef[] = [
  f('print.copyLabel', 'text', 'Copy 2'),
  f('print.issue_date', 'text', '01 Jan 2027'),
];

const ACR_CRITERIA: FieldDef[] = Array.from(
  { length: ACR_CRITERIA_SLOTS },
  (_, i) => i + 1,
).flatMap((n) => [
  f(`acr.criterion.${n}.label`, 'text', 'Punctuality and attendance'),
  f(`acr.criterion.${n}.label_bn`, 'text', 'সময়ানুবর্তিতা ও উপস্থিতি'),
  f(`acr.criterion.${n}.score`, 'text', '4'),
]);

export const FIELD_CATALOG: Record<DocumentKind, FieldDef[]> = {
  [DocumentKind.STUDENT_ID_CARD]: [
    ...SCHOOL,
    f('student.name', 'text', 'Mohammad Rahim Uddin', 'Mohammad Abdullah Al Mamun Rahim Uddin'),
    f(
      'student.name_bn',
      'text',
      'মোহাম্মদ রহিম উদ্দিন',
      'মোহাম্মদ আব্দুল্লাহ আল মামুন রহিম উদ্দিন',
    ),
    f('student.class', 'text', 'Class 8'),
    f('student.section', 'text', 'A'),
    f('student.roll', 'text', '12'),
    f('student.registration_number', 'text', '2027-000123'),
    f('student.blood_group', 'text', 'B+'),
    f('student.date_of_birth', 'text', '05 May 2013'),
    f('student.photo', 'image', 'photo'),
    f('guardian.phone', 'text', '01811-000000'),
    ...COMMON_TAIL,
  ],
  [DocumentKind.STAFF_ID_CARD]: [
    ...SCHOOL,
    f('staff.name', 'text', 'Fatema Begum', 'Mst. Fatema Khatun Begum Chowdhury'),
    f('staff.name_bn', 'text', 'ফাতেমা বেগম', 'মোছাঃ ফাতেমা খাতুন বেগম চৌধুরী'),
    f('staff.designation', 'text', 'Assistant Teacher', 'Senior Assistant Teacher (Mathematics)'),
    f('staff.employee_id', 'text', 'EMP-0042'),
    f('staff.blood_group', 'text', 'O+'),
    f('staff.phone', 'text', '01911-000000'),
    f('staff.photo', 'image', 'photo'),
    ...COMMON_TAIL,
  ],
  [DocumentKind.ACR_ASSESSMENT]: [
    ...SCHOOL,
    f('staff.name', 'text', 'Fatema Begum', 'Mst. Fatema Khatun Begum Chowdhury'),
    f('staff.name_bn', 'text', 'ফাতেমা বেগম', 'মোছাঃ ফাতেমা খাতুন বেগম চৌধুরী'),
    f('staff.designation', 'text', 'Assistant Teacher', 'Senior Assistant Teacher (Mathematics)'),
    f('acr.year', 'text', '2026'),
    f('acr.total', 'text', '82'),
    f('acr.completed_on', 'text', '31 Dec 2026'),
    ...ACR_CRITERIA,
    ...ACR_TAIL,
  ],
};
