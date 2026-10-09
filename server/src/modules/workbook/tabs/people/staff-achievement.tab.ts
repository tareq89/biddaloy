import { StaffAchievement } from '../../../staff-hr/entities/staff-achievement.entity';
import { createStaffChildTab } from './staff-child-tab.factory';

/** The `staff_achievements` tab (23.5): achievement/award rows. */
export const staffAchievementTab = createStaffChildTab<StaffAchievement>({
  name: 'staff_achievements',
  entityClass: StaffAchievement,
  naturalKeyFields: ['title'],
  fields: [
    { key: 'title', type: 'string', required: true, label: { en: 'Title', bn: 'শিরোনাম' } },
    { key: 'description', type: 'string', label: { en: 'Description', bn: 'বিবরণ' } },
    { key: 'date', type: 'date', label: { en: 'Date', bn: 'তারিখ' } },
    { key: 'issued_by', type: 'string', label: { en: 'Issued by', bn: 'প্রদানকারী' } },
  ],
});
export type StaffAchievementRow = Record<string, unknown>;
