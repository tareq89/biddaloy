import { ReportSubjectArea } from '@biddaloy/shared';
import type { SubjectAreaDef } from '../registry.types';

/** Stub: only the root is described. [8.15.21] adds the joins, fields and measures. */
export const attendanceArea: SubjectAreaDef = {
  key: ReportSubjectArea.ATTENDANCE,
  root: { alias: 'ar', table: 'attendance_records', tenantColumn: 'tenant_id' },
  joins: [],
  fields: [],
  measures: [],
};
