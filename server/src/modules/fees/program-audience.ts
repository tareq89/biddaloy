import { ObjectLiteral, SelectQueryBuilder } from 'typeorm';

/** [34.2.2/D26] The one program-audience join fragment, shared by the daily
 * scheduler (`fees-daily.scheduler.ts`) and one-off generation targeting
 * (`fee-generation.service.ts`) — no second SQL fragment. Matches students
 * with an ACTIVE `ProgramEnrollment` in `programId` for this tenant. `qb`
 * must alias the `Student` query as `'s'` (both call sites do). A sibling
 * file rather than living in either service, so importing it from one
 * doesn't create a circular import with the other. */
export function applyProgramAudience<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  programId: string,
  tenantId: string,
): void {
  qb.innerJoin(
    'program_enrollments',
    'pe',
    'pe.student_id = s.id AND pe.program_id = :programId AND pe.tenant_id = :peTenantId AND pe.status = :peStatus',
    { programId, peTenantId: tenantId, peStatus: 'ACTIVE' },
  );
}
