export { XLSX_MIME } from '../export/export.constants';

/** The two languages a template can be generated in (epic 14.0 D12). */
export type TemplateLang = 'bn' | 'en';

export type TemplateVariant = 'full' | 'starter';

/**
 * [13.3.3] The five sheets a new school needs to get going. Names are copied exactly from
 * `EXPECTED_TABS` (`codec/registry.ts`); the template spec fails if one drifts.
 */
export const STARTER_TABS = [
  'academic_years',
  'classes',
  'sections',
  'subjects',
  'fee_structures',
] as const;
