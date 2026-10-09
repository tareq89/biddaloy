import { StaffFamilyMember } from '../../../staff-hr/entities/staff-family-member.entity';
import { createStaffChildTab } from './staff-child-tab.factory';

/** The `staff_family_members` tab (23.5): family rows for a staff member. */
export const staffFamilyMemberTab = createStaffChildTab<StaffFamilyMember>({
  name: 'staff_family_members',
  entityClass: StaffFamilyMember,
  naturalKeyFields: ['relation', 'name'],
  fields: [
    { key: 'relation', type: 'string', required: true, label: { en: 'Relation', bn: 'সম্পর্ক' } },
    { key: 'name', type: 'string', required: true, label: { en: 'Name', bn: 'নাম' } },
    { key: 'occupation', type: 'string', label: { en: 'Occupation', bn: 'পেশা' } },
    { key: 'contact', type: 'string', label: { en: 'Contact', bn: 'যোগাযোগ' } },
  ],
});
export type StaffFamilyMemberRow = Record<string, unknown>;
