import { ReportSubjectArea } from '@biddaloy/shared';
import type { SubjectAreaDef } from '../registry.types';

/** Stub: only the root is described. [8.15.20] adds the joins, fields and measures. */
export const publicExamsArea: SubjectAreaDef = {
  key: ReportSubjectArea.PUBLIC_EXAMS,
  root: {
    alias: 'pe',
    table: 'student_public_exams',
    tenantColumn: 'tenant_id',
    softDeleteColumn: 'deleted_at',
  },
  joins: [],
  fields: [],
  measures: [],
};
