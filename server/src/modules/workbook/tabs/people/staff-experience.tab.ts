import { StaffExperience } from '../../../staff-hr/entities/staff-experience.entity';
import { createStaffChildTab } from './staff-child-tab.factory';

/** The `staff_experience` tab (23.5): prior work-experience rows. */
export const staffExperienceTab = createStaffChildTab<StaffExperience>({
  name: 'staff_experience',
  entityClass: StaffExperience,
  naturalKeyFields: ['institution', 'from_date'],
  fields: [
    { key: 'institution', type: 'string', required: true, label: { en: 'Institution', bn: 'প্রতিষ্ঠান' } },
    { key: 'designation', type: 'string', required: true, label: { en: 'Designation', bn: 'পদবি' } },
    { key: 'from_date', type: 'date', required: true, label: { en: 'From date', bn: 'শুরুর তারিখ' } },
    { key: 'to_date', type: 'date', label: { en: 'To date', bn: 'শেষ তারিখ' } },
    { key: 'description', type: 'string', label: { en: 'Description', bn: 'বিবরণ' } },
  ],
});
export type StaffExperienceRow = Record<string, unknown>;
