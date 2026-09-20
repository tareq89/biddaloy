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
} as const;

export type EntityLabel = (typeof EntityLabel)[keyof typeof EntityLabel];
