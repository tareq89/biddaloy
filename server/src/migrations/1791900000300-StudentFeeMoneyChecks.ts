import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [2636, D23] Two database CHECKs on `student_fees`:
 *
 * - `CHK_sf_paid_plus_discount`: a bill never takes more than its total (`paid + discount <= total`).
 * - `CHK_sf_waived_settled`: a WAIVED bill is fully settled (`paid + discount = total`).
 *
 * Both are NOT VALID: new and changed rows are checked, rows already in a database are left alone
 * and never auto-fixed (a QA clone already holds over-collected rows).
 *
 * Run this read-only audit on every environment, fix the rows by hand, then
 * `ALTER TABLE student_fees VALIDATE CONSTRAINT "<name>"` as a separate, later deploy step:
 *
 *   SELECT id, student_id, total_amount, paid_amount, discount_amount, status
 *     FROM student_fees
 *    WHERE deleted_at IS NULL
 *      AND (paid_amount + discount_amount > total_amount
 *           OR (status = 'WAIVED' AND paid_amount + discount_amount <> total_amount));
 *
 * NOT VALID does not cover a restore: restored rows are INSERTs, so they are checked.
 * - School workbook restore: the `student_fees` tab rejects a bad row by row and column before
 *   any write, so the restore is refused with a list, not a 500.
 * - Platform restore (`restore.sh`): `pg_dump` adds a NOT VALID CHECK after the data, so old rows
 *   load. Run the audit above on the restored database before any VALIDATE.
 * - A later UPDATE of an old bad row (a reversal, a regeneration) fails the CHECK; the known-errors
 *   filter maps that 23514 to a fixed 409.
 * See docs/architecture/13-backup-restore.md "Old fee rows and the money CHECKs".
 *
 * (`CHK_sf_paid_amount`, paid >= 0, already exists from the InitialSchema migration.)
 */
export class StudentFeeMoneyChecks1791900000300 implements MigrationInterface {
  name = 'StudentFeeMoneyChecks1791900000300';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "student_fees" ADD CONSTRAINT "CHK_sf_paid_plus_discount" CHECK ("paid_amount" + "discount_amount" <= "total_amount") NOT VALID`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_fees" ADD CONSTRAINT "CHK_sf_waived_settled" CHECK ("status" <> 'WAIVED' OR "paid_amount" + "discount_amount" = "total_amount") NOT VALID`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "student_fees" DROP CONSTRAINT "CHK_sf_waived_settled"`);
    await queryRunner.query(
      `ALTER TABLE "student_fees" DROP CONSTRAINT "CHK_sf_paid_plus_discount"`,
    );
  }
}
