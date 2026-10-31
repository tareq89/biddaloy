import { ReportSubjectArea } from '@biddaloy/shared';
import type { SubjectAreaDef } from '../registry.types';

/** Stub: only the root is described. [8.15.21] adds the joins, fields and measures. */
export const paymentsArea: SubjectAreaDef = {
  key: ReportSubjectArea.PAYMENTS,
  root: {
    alias: 'p',
    table: 'payments',
    tenantColumn: 'tenant_id',
    softDeleteColumn: 'deleted_at',
  },
  joins: [],
  fields: [],
  measures: [],
};
