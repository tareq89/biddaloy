import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [8.10.7.6.02] Covering partial indexes for the money dashboard widgets
 * (collection-by-month, committee-finance). Each widget sums over almost the whole year,
 * so the planner chose a full table scan; with every column the query reads in the index
 * (and the same WHERE as a partial predicate) it can read the index alone.
 * Indexes only: no table or column changes, so the demo seed is untouched.
 * CREATE INDEX blocks writes to the table while it builds (the repo never uses CONCURRENTLY);
 * fine at current sizes.
 */
export class DashboardMoneyCoveringIndexes1791900000200 implements MigrationInterface {
  name = 'DashboardMoneyCoveringIndexes1791900000200';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_payments_dash_net" ON "payments" ("tenant_id", "payment_date", "total_amount", "reversal_of_payment_id") WHERE "deleted_at" IS NULL AND ("payment_status" = 'SUCCESS' OR "reversal_of_payment_id" IS NOT NULL OR "reversed_by_payment_id" IS NOT NULL)`,
    );
    // ponytail: no tenant column, so it scans every school's bills in the period range.
    // Revisit with EXPLAIN on multi-tenant data.
    await queryRunner.query(
      `CREATE INDEX "IDX_student_fees_dash_billing" ON "student_fees" ("period_start", "student_id", "total_amount", "discount_amount", "paid_amount", "status") WHERE "deleted_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_student_fees_dash_billing"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_payments_dash_net"`);
  }
}
