import { EntityManager, IsNull } from 'typeorm';
import { Student } from './entities/student.entity';

/**
 * Arbitrary second key for `pg_advisory_xact_lock`'s two-key form, paired
 * with the target class_section_id's hash — keeps this lock's keyspace
 * separate from the registration-number lock's (hashtext(tenant_id), year)
 * pair. Shared between `StudentService.create` (a new student's first
 * roll number) and `EnrollmentService` ([8.11.3] — reassigning a roll
 * number when a student moves into a section) so two concurrent writers
 * targeting the same section can never race to the same number.
 */
export const ROLL_NUMBER_LOCK_NAMESPACE = 741852;

/**
 * Returns the next available roll number in a class section, serialized
 * against concurrent callers via a transaction-scoped advisory lock (see
 * `ROLL_NUMBER_LOCK_NAMESPACE` above).
 *
 * `SELECT ... ORDER BY roll_number DESC` alone only locks rows that
 * already exist, so two transactions computing the very first roll number
 * for a brand-new section would both see no rows and race to 1. The
 * advisory lock serializes generation regardless of whether any row
 * exists yet; it's transaction-scoped, so it releases automatically on
 * commit/rollback — the caller MUST invoke this inside the same
 * transaction that persists the roll number, or the lock does nothing
 * useful.
 */
export async function nextRollNumber(
  manager: EntityManager,
  classSectionId: string,
  tenantId: string,
): Promise<number> {
  await manager.query('SELECT pg_advisory_xact_lock(hashtext($1), $2)', [
    classSectionId,
    ROLL_NUMBER_LOCK_NAMESPACE,
  ]);

  // `deleted_at: IsNull()` — a soft-deleted student's roll number is free
  // to reuse, matching the original inline logic this util replaces.
  const lastRoll = await manager.getRepository(Student).findOne({
    where: { class_section_id: classSectionId, tenant_id: tenantId, deleted_at: IsNull() },
    order: { roll_number: 'DESC' },
  });

  return lastRoll ? lastRoll.roll_number + 1 : 1;
}
