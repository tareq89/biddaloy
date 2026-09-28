import { StaffTraining } from '../../../staff-hr/entities/staff-training.entity';
import { createStaffChildTab } from './staff-child-tab.factory';

/** The `staff_training` tab (23.5): training rows for a staff member. */
export const staffTrainingTab = createStaffChildTab<StaffTraining>({
  name: 'staff_training',
  entityClass: StaffTraining,
  naturalKeyFields: ['title', 'institution'],
  fields: [
    { key: 'title', type: 'string', required: true, label: { en: 'Title', bn: 'শিরোনাম' } },
    { key: 'institution', type: 'string', required: true, label: { en: 'Institution', bn: 'প্রতিষ্ঠান' } },
    { key: 'from_date', type: 'date', required: true, label: { en: 'From date', bn: 'শুরুর তারিখ' } },
    { key: 'to_date', type: 'date', label: { en: 'To date', bn: 'শেষ তারিখ' } },
    { key: 'certificate_no', type: 'string', label: { en: 'Certificate no.', bn: 'সনদ নং' } },
  ],
});
export type StaffTrainingRow = Record<string, unknown>;
