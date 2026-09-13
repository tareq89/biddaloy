import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `student_fees` becomes one bill per student × fee structure × period,
 * instead of one row per student × month that silently summed every
 * applicable fee structure together (16.1.3, part of Epic 16's fee rebuild —
 * see #637 D2/D5/D8/D11/D19).
 *
 * `TRUNCATE ... CASCADE` first (D19): there is no production data yet, so
 * this is a straight destructive rebuild rather than a backfill. Rollback
 * cannot restore the truncated rows — `down()` only reverses the schema.
 */
export class StudentFeeAsBill1789800000000 implements MigrationInterface {
  name = 'StudentFeeAsBill1789800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // No production data yet (D19) — truncate rather than backfill.
    // CASCADE also empties payment_allocations, which FKs to student_fees.
    await queryRunner.query(`TRUNCATE TABLE "student_fees", "payment_allocations" CASCADE`);

    // Old constraints/columns tied to the one-row-per-month shape.
    await queryRunner.query(
      `ALTER TABLE "student_fees" DROP CONSTRAINT "UQ_4ab7f49422cab5d6df391f9490f"`,
    );
    await queryRunner.query(`ALTER TABLE "student_fees" DROP COLUMN "is_advance_payment"`);
    await queryRunner.query(`ALTER TABLE "student_fees" DROP COLUMN "original_advance_month"`);
    await queryRunner.query(`ALTER TABLE "student_fees" DROP COLUMN "original_advance_year"`);

    // `month`/`year` become stored generated columns derived from
    // `period_start` — every existing filter/query on them keeps working.
    await queryRunner.query(`ALTER TABLE "student_fees" DROP COLUMN "month"`);
    await queryRunner.query(`ALTER TABLE "student_fees" DROP COLUMN "year"`);

    await queryRunner.query(`ALTER TABLE "student_fees" ADD COLUMN "fee_structure_id" uuid`);
    await queryRunner.query(`ALTER TABLE "student_fees" ADD COLUMN "fee_generation_id" uuid`);
    await queryRunner.query(`ALTER TABLE "student_fees" ADD COLUMN "period_start" date`);
    await queryRunner.query(
      `CREATE TYPE "public"."student_fees_period_type_enum" AS ENUM('MONTH', 'WEEK')`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_fees" ADD COLUMN "period_type" "public"."student_fees_period_type_enum" NOT NULL DEFAULT 'MONTH'`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_fees" ADD COLUMN "occurrence" integer NOT NULL DEFAULT 1`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_fees" ADD COLUMN "standing_discount_amount" numeric(10,2) NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_fees" ADD COLUMN "one_off_discount_amount" numeric(10,2) NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(`ALTER TABLE "student_fees" ADD COLUMN "approved_by_user_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "student_fees" ADD COLUMN "late_fee_for_student_fee_id" uuid`,
    );

    await queryRunner.query(
      `ALTER TABLE "student_fees" ADD COLUMN "month" integer GENERATED ALWAYS AS (EXTRACT(MONTH FROM period_start)::int) STORED`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_fees" ADD COLUMN "year" integer GENERATED ALWAYS AS (EXTRACT(YEAR FROM period_start)::int) STORED`,
    );

    // `DROP COLUMN "month"`/`"year"` above cascaded away the two CHECKs
    // `InitialSchema` put on them — re-add with the same names so the
    // entity's `@Check` decorators (which never changed) stop drifting
    // from the DB.
    await queryRunner.query(
      `ALTER TABLE "student_fees" ADD CONSTRAINT "CHK_14a0bf3f656dacb98615d013e7" CHECK ("year" > 0)`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_fees" ADD CONSTRAINT "CHK_fc7527d9e64e4d01667febc89f" CHECK ("month" BETWEEN 1 AND 12)`,
    );

    // The table is empty (truncated above), so it's safe to add the
    // fee_structure_id/period_start NOT NULL constraints after backfilling
    // nothing.
    await queryRunner.query(
      `ALTER TABLE "student_fees" ALTER COLUMN "fee_structure_id" SET NOT NULL`,
    );
    await queryRunner.query(`ALTER TABLE "student_fees" ALTER COLUMN "period_start" SET NOT NULL`);

    await queryRunner.query(
      `ALTER TABLE "student_fees" ADD CONSTRAINT "FK_student_fees_fee_structure_id" FOREIGN KEY ("fee_structure_id") REFERENCES "fee_structures"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_fees" ADD CONSTRAINT "FK_student_fees_late_fee_for_student_fee_id" FOREIGN KEY ("late_fee_for_student_fee_id") REFERENCES "student_fees"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `ALTER TABLE "student_fees" ADD CONSTRAINT "UQ_student_fees_student_structure_period_occurrence" UNIQUE ("student_id", "fee_structure_id", "period_start", "occurrence")`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_fees" ADD CONSTRAINT "CHK_student_fees_discount_split" CHECK (discount_amount = standing_discount_amount + one_off_discount_amount)`,
    );
    // One late fee per original bill — partial unique index, since most
    // rows have a NULL late_fee_for_student_fee_id and must not collide.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_student_fees_late_fee_for_student_fee_id" ON "student_fees" ("late_fee_for_student_fee_id") WHERE "late_fee_for_student_fee_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_student_fees_period_start" ON "student_fees" ("period_start")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_student_fees_fee_generation_id" ON "student_fees" ("fee_generation_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Data note: rows truncated in up() are not restorable. This only
    // reverses the schema back to the one-row-per-month shape.
    await queryRunner.query(`DROP INDEX "public"."IDX_student_fees_fee_generation_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_student_fees_period_start"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_student_fees_late_fee_for_student_fee_id"`);
    await queryRunner.query(
      `ALTER TABLE "student_fees" DROP CONSTRAINT "CHK_student_fees_discount_split"`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_fees" DROP CONSTRAINT "UQ_student_fees_student_structure_period_occurrence"`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_fees" DROP CONSTRAINT "FK_student_fees_late_fee_for_student_fee_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_fees" DROP CONSTRAINT "FK_student_fees_fee_structure_id"`,
    );

    await queryRunner.query(
      `ALTER TABLE "student_fees" DROP CONSTRAINT "CHK_fc7527d9e64e4d01667febc89f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_fees" DROP CONSTRAINT "CHK_14a0bf3f656dacb98615d013e7"`,
    );

    await queryRunner.query(`ALTER TABLE "student_fees" DROP COLUMN "year"`);
    await queryRunner.query(`ALTER TABLE "student_fees" DROP COLUMN "month"`);

    await queryRunner.query(`ALTER TABLE "student_fees" DROP COLUMN "late_fee_for_student_fee_id"`);
    await queryRunner.query(`ALTER TABLE "student_fees" DROP COLUMN "approved_by_user_id"`);
    await queryRunner.query(`ALTER TABLE "student_fees" DROP COLUMN "one_off_discount_amount"`);
    await queryRunner.query(`ALTER TABLE "student_fees" DROP COLUMN "standing_discount_amount"`);
    await queryRunner.query(`ALTER TABLE "student_fees" DROP COLUMN "occurrence"`);
    await queryRunner.query(`ALTER TABLE "student_fees" DROP COLUMN "period_type"`);
    await queryRunner.query(`DROP TYPE "public"."student_fees_period_type_enum"`);
    await queryRunner.query(`ALTER TABLE "student_fees" DROP COLUMN "period_start"`);
    await queryRunner.query(`ALTER TABLE "student_fees" DROP COLUMN "fee_generation_id"`);
    await queryRunner.query(`ALTER TABLE "student_fees" DROP COLUMN "fee_structure_id"`);

    await queryRunner.query(
      `ALTER TABLE "student_fees" ADD COLUMN "original_advance_year" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_fees" ADD COLUMN "original_advance_month" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_fees" ADD COLUMN "is_advance_payment" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(`ALTER TABLE "student_fees" ADD COLUMN "month" integer`);
    await queryRunner.query(`ALTER TABLE "student_fees" ADD COLUMN "year" integer`);
    // Restore the original two CHECKs `InitialSchema` had on plain
    // `month`/`year` columns, dropped above along with `up()`'s generated
    // ones (same names — no drift with the also-restored entity shape).
    await queryRunner.query(
      `ALTER TABLE "student_fees" ADD CONSTRAINT "CHK_fc7527d9e64e4d01667febc89f" CHECK ("month" BETWEEN 1 AND 12)`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_fees" ADD CONSTRAINT "CHK_14a0bf3f656dacb98615d013e7" CHECK ("year" > 0)`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_fees" ADD CONSTRAINT "UQ_4ab7f49422cab5d6df391f9490f" UNIQUE ("student_id", "academic_year_id", "month", "year")`,
    );
  }
}
