import { StaffIncident } from '../../../incidents/entities/staff-incident.entity';
import { createRefChildTab } from './ref-child-tab.factory';
import { usersTab } from './users.tab';

/**
 * [28.1.3] `staff_incidents`. No DB unique key, so `created_at` (second-level
 * resolution) joins the natural key to keep two same-day incidents apart.
 */
export const staffIncidentsTab = createRefChildTab<StaffIncident>({
  name: 'staff_incidents',
  entityClass: StaffIncident,
  refs: [
    { key: 'staff', fk: 'staff_user_id', tab: usersTab, label: { en: 'Staff', bn: 'কর্মী' } },
    { key: 'reporter', fk: 'reported_by', tab: usersTab, label: { en: 'Reported by', bn: 'রিপোর্টকারী' } },
  ],
  fields: [
    {
      key: 'type',
      type: 'enum',
      enumValues: ['BEHAVIOUR', 'ABSENCE', 'COMPLAINT', 'COMMENDATION', 'OTHER'],
      required: true,
      label: { en: 'Type', bn: 'ধরন' },
    },
    {
      key: 'severity',
      type: 'enum',
      enumValues: ['LOW', 'MEDIUM', 'HIGH'],
      required: true,
      label: { en: 'Severity', bn: 'গুরুত্ব' },
    },
    { key: 'body', type: 'string', required: true, label: { en: 'Details', bn: 'বিবরণ' } },
    { key: 'occurred_on', type: 'date', required: true, label: { en: 'Occurred on', bn: 'ঘটার তারিখ' } },
    { key: 'created_at', type: 'datetime', required: true, label: { en: 'Created at', bn: 'তৈরির সময়' } },
  ],
  naturalKey: ['staff', 'occurred_on', 'type', 'created_at'],
});

export const incidentsTabs = [staffIncidentsTab];
