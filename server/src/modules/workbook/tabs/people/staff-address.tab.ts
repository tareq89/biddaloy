import { StaffAddress } from '../../../staff-hr/entities/staff-address.entity';
import { createStaffChildTab } from './staff-child-tab.factory';

/** The `staff_addresses` tab (23.5): present/permanent address rows. */
export const staffAddressTab = createStaffChildTab<StaffAddress>({
  name: 'staff_addresses',
  entityClass: StaffAddress,
  naturalKeyFields: ['type'],
  fields: [
    {
      key: 'type',
      type: 'enum',
      required: true,
      enumValues: ['PRESENT', 'PERMANENT'],
      label: { en: 'Type', bn: 'প্রকার' },
    },
    { key: 'village_street', type: 'string', label: { en: 'Village/street', bn: 'গ্রাম/সড়ক' } },
    { key: 'post_office', type: 'string', label: { en: 'Post office', bn: 'ডাকঘর' } },
    { key: 'upazila', type: 'string', label: { en: 'Upazila', bn: 'উপজেলা' } },
    { key: 'district', type: 'string', label: { en: 'District', bn: 'জেলা' } },
  ],
});
export type StaffAddressRow = Record<string, unknown>;
