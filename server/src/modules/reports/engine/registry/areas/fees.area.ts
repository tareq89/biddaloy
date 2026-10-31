import { ReportSubjectArea } from '@biddaloy/shared';
import type { SubjectAreaDef } from '../registry.types';

const students = {
  alias: 's',
  table: 'students',
  tenantColumn: 'tenant_id',
  softDeleteColumn: 'deleted_at',
} as const;

/**
 * Stub: only the structure is described. `student_fees` has no `tenant_id`, so its school
 * comes from the always-joined student (`tenantVia`). [8.15.21] adds the fields and measures.
 */
export const feesArea: SubjectAreaDef = {
  key: ReportSubjectArea.FEES,
  root: {
    alias: 'sf',
    table: 'student_fees',
    tenantColumn: null,
    tenantVia: 's',
    softDeleteColumn: 'deleted_at',
  },
  joins: [{ from: 'sf', to: students, on: 'sf.student_id = s.id', kind: 'inner' }],
  fields: [],
  measures: [],
};
