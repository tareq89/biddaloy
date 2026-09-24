/**
 * Entity-noun keys the client renders today (nav, breadcrumbs, page
 * titles), plus three names Epic 35.0's tenant label-override table needs
 * ahead of time (`academicYear`, `subject`, `fee` — kept here rather than
 * added later so the override table's keys match this set from day one).
 *
 * Each value is the i18n key suffix used to look up the noun's translation,
 * e.g. `EntityLabel.class` → `'class'` → `t('entity.class')`.
 *
 * [30.1.1] This is the only file in Epic 30.0 allowed to add a new export
 * surface under `shared/`; 30.1.2 (label seam) and Epic 35.0 (tenant
 * override table) both key off `EntityLabel`.
 */
export const EntityLabel = {
  class: 'class',
  section: 'section',
  student: 'student',
  guardian: 'guardian',
  staff: 'staff',
  teacher: 'teacher',
  academicYear: 'academicYear',
  subject: 'subject',
  fee: 'fee',
  invoice: 'invoice',
  payment: 'payment',
  // [33.1.1] Epic 33.0's org-structure vocabulary. Values live per-tenant on
  // `TenantSettings.organisation`, not here — this only reserves the keys.
  shift: 'shift',
  version: 'version',
  group: 'group',
  // [19.1.1] Epic 19.0's exams/marks/results spine.
  exam: 'exam',
  mark: 'mark',
  result: 'result',
  // [21.1.1] Epic 21.0's class-routine vocabulary, reserved ahead of Epic
  // 35.0's tenant label-override table the same way the entries above are.
  room: 'room',
  routine: 'routine',
  // [22.1.1] Epic 22.0's homework/syllabus vocabulary.
  homework: 'homework',
  homeworkAssignment: 'homeworkAssignment',
  homeworkSubmission: 'homeworkSubmission',
  syllabusTopic: 'syllabusTopic',
} as const;

export type EntityLabel = (typeof EntityLabel)[keyof typeof EntityLabel];
