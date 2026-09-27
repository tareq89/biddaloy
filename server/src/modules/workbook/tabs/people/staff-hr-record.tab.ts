import { StaffHrRecord } from '../../../staff-hr/entities/staff-hr-record.entity';
import { createStaffChildTab } from './staff-child-tab.factory';

/** The `staff_hr_records` tab (23.5): one job-info row per staff member,
 * keyed by `user_id` per 23.1 D1. */
export const staffHrRecordTab = createStaffChildTab<StaffHrRecord>({
  name: 'staff_hr_records',
  entityClass: StaffHrRecord,
  staffFkKey: 'user',
  naturalKeyFields: [],
  fields: [
    { key: 'index_no', type: 'string', label: { en: 'Index no.', bn: 'ইনডেক্স নং' } },
    { key: 'salary_code', type: 'string', label: { en: 'Salary code', bn: 'বেতন কোড' } },
    { key: 'mpo_date', type: 'date', label: { en: 'MPO date', bn: 'এমপিও তারিখ' } },
    { key: 'salary_scale', type: 'string', label: { en: 'Salary scale', bn: 'বেতন স্কেল' } },
    { key: 'department', type: 'string', label: { en: 'Department', bn: 'বিভাগ' } },
    { key: 'blood_group', type: 'string', label: { en: 'Blood group', bn: 'রক্তের গ্রুপ' } },
    { key: 'religion', type: 'string', label: { en: 'Religion', bn: 'ধর্ম' } },
  ],
});
export type StaffHrRecordRow = Record<string, unknown>;
