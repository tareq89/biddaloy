import { StaffEducation } from '../../../staff-hr/entities/staff-education.entity';
import { createStaffChildTab } from './staff-child-tab.factory';

/** The `staff_education` tab (23.5): education rows for a staff member. */
export const staffEducationTab = createStaffChildTab<StaffEducation>({
  name: 'staff_education',
  entityClass: StaffEducation,
  naturalKeyFields: ['degree', 'institution'],
  fields: [
    { key: 'degree', type: 'string', required: true, label: { en: 'Degree', bn: 'ডিগ্রি' } },
    { key: 'institution', type: 'string', required: true, label: { en: 'Institution', bn: 'প্রতিষ্ঠান' } },
    { key: 'board_university', type: 'string', label: { en: 'Board/university', bn: 'বোর্ড/বিশ্ববিদ্যালয়' } },
    { key: 'result', type: 'string', label: { en: 'Result', bn: 'ফলাফল' } },
    { key: 'passing_year', type: 'string', label: { en: 'Passing year', bn: 'পাসের বছর' } },
  ],
});
export type StaffEducationRow = Record<string, unknown>;
