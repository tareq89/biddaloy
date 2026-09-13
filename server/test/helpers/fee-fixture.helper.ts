import { DataSource } from 'typeorm';
import { SEED_TENANT_ID, SEED_CLASS_1_ID, SEED_ACADEMIC_YEAR_ID } from '@test/constants';

/**
 * Shared fee fixtures for e2e specs that insert `student_fees` rows with raw
 * SQL.
 *
 * Two things changed under those specs in Epic 16 wave 1:
 *
 * - `student_fees.fee_structure_id` became NOT NULL (16.1.3) — a bill is now
 *   always "this student owes *this* price tag for this period".
 * - `student_fees.month` and `.year` became stored generated columns derived
 *   from `period_start`, so Postgres rejects any attempt to write them
 *   directly (SQLSTATE 428C9).
 *
 * So a raw insert now looks like:
 *
 * ```ts
 * const structureId = await ensureFeeStructure(dataSource);
 * await dataSource.query(
 *   `INSERT INTO student_fees
 *      (id, student_id, academic_year_id, fee_structure_id, period_start,
 *       total_amount, paid_amount, discount_amount, status, created_at, updated_at)
 *    VALUES (DEFAULT, $1, $2, $3, $4::date, 1000, 0, 0, 'PENDING', NOW(), NOW())`,
 *   [studentId, SEED_ACADEMIC_YEAR_ID, structureId, periodStart(5, 2026)],
 * );
 * ```
 */

/**
 * Returns the id of a fee structure for `tenantId`, creating one if the
 * tenant has none. Safe to call repeatedly — e2e specs truncate
 * `fee_structures` between files, so this re-creates it rather than caching
 * an id that may no longer exist.
 */
export async function ensureFeeStructure(
  dataSource: DataSource,
  tenantId: string = SEED_TENANT_ID,
  classId: string = SEED_CLASS_1_ID,
  academicYearId: string = SEED_ACADEMIC_YEAR_ID,
): Promise<string> {
  const existing = await dataSource.query(
    `SELECT id FROM fee_structures WHERE tenant_id = $1 AND deleted_at IS NULL LIMIT 1`,
    [tenantId],
  );
  if (existing.length > 0) return existing[0].id as string;

  const created = await dataSource.query(
    `INSERT INTO fee_structures
       (id, fee_type, name, amount, class_id, academic_year_id, tenant_id, created_at, updated_at)
     VALUES (DEFAULT, 'MONTHLY_TUITION', 'Test Tuition', 1000, $1, $2, $3, NOW(), NOW())
     RETURNING id`,
    [classId, academicYearId, tenantId],
  );
  return created[0].id as string;
}

/** First day of `month`/`year` as a `YYYY-MM-DD` string, for `period_start`. */
export function periodStart(month: number, year: number): string {
  return `${year}-${String(month).padStart(2, '0')}-01`;
}
