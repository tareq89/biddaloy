import { ReportSubjectArea } from '@biddaloy/shared';
import type { SubjectAreaDef } from '../registry.types';

/** Stub: only the root is described. [8.15.20] adds the joins, fields and measures. */
export const staffArea: SubjectAreaDef = {
  key: ReportSubjectArea.STAFF,
  root: { alias: 'sp', table: 'staff_profiles', tenantColumn: 'tenant_id' },
  joins: [],
  fields: [],
  measures: [],
};
