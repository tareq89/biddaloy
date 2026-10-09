import { StaffLanguage } from '../../../staff-hr/entities/staff-language.entity';
import { createStaffChildTab } from './staff-child-tab.factory';

/** The `staff_languages` tab (23.5): language-proficiency rows. */
export const staffLanguageTab = createStaffChildTab<StaffLanguage>({
  name: 'staff_languages',
  entityClass: StaffLanguage,
  naturalKeyFields: ['language_name'],
  fields: [
    { key: 'language_name', type: 'string', required: true, label: { en: 'Language', bn: 'ভাষা' } },
    { key: 'proficiency', type: 'string', label: { en: 'Proficiency', bn: 'দক্ষতা' } },
  ],
});
export type StaffLanguageRow = Record<string, unknown>;
