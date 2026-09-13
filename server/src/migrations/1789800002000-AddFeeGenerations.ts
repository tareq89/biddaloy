import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [16.1.4] `fee_generations` — one row per Generate press or schedule run,
 * the log page's data source. Also adds `student_fees.fee_generation_id`
 * (nullable FK, `ON DELETE SET NULL` — a batch being purged never orphans
 * the bills it already created) so a bill can be traced back to the batch
 * that generated it.
 */
export class AddFeeGenerations1789800002000 implements MigrationInterface {
  name = 'AddFeeGenerations1789800002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."fee_generations_period_type_enum" AS ENUM('MONTH', 'WEEK')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."fee_generations_source_enum" AS ENUM('MANUAL', 'SCHEDULE')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."fee_generations_duplicate_strategy_enum" AS ENUM('SKIP', 'REMOVE_OLDER', 'CREATE_ANYWAY')`,
    );
    await queryRunner.query(
      `CREATE TABLE "fee_generations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "academic_year_id" uuid NOT NULL,
        "period_start" date NOT NULL,
        "period_type" "public"."fee_generations_period_type_enum" NOT NULL,
        "due_date" date NOT NULL,
        "source" "public"."fee_generations_source_enum" NOT NULL,
        "recurring_schedule_id" uuid,
        "generated_by_user_id" uuid,
        "approved_by_user_id" uuid,
        "duplicate_strategy" "public"."fee_generations_duplicate_strategy_enum" NOT NULL,
        "notify_families" boolean NOT NULL DEFAULT false,
        "structures" jsonb NOT NULL,
        "student_count" integer NOT NULL,
        "generated_count" integer NOT NULL,
        "skipped_count" integer NOT NULL,
        "removed_count" integer NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_fee_generations_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fee_generations_tenant_id" ON "fee_generations" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fee_generations_tenant_created" ON "fee_generations" ("tenant_id", "created_at")`,
    );
    await queryRunner.query(
      `ALTER TABLE "fee_generations" ADD CONSTRAINT "FK_fee_generations_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "fee_generations" ADD CONSTRAINT "FK_fee_generations_academic_year" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "fee_generations" ADD CONSTRAINT "FK_fee_generations_generated_by" FOREIGN KEY ("generated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "fee_generations" ADD CONSTRAINT "FK_fee_generations_approved_by" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // `student_fees.fee_generation_id` and its index were already added by
    // 16.1.3's StudentFeeAsBill migration (same-wave, runs first per this
    // migration's timestamp) — only the FK back to fee_generations belongs
    // here, since fee_generations doesn't exist until this migration runs.
    await queryRunner.query(
      `ALTER TABLE "student_fees" ADD CONSTRAINT "FK_student_fees_fee_generation" FOREIGN KEY ("fee_generation_id") REFERENCES "fee_generations"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "student_fees" DROP CONSTRAINT "FK_student_fees_fee_generation"`,
    );

    await queryRunner.query(
      `ALTER TABLE "fee_generations" DROP CONSTRAINT "FK_fee_generations_approved_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "fee_generations" DROP CONSTRAINT "FK_fee_generations_generated_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "fee_generations" DROP CONSTRAINT "FK_fee_generations_academic_year"`,
    );
    await queryRunner.query(
      `ALTER TABLE "fee_generations" DROP CONSTRAINT "FK_fee_generations_tenant"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_fee_generations_tenant_created"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_fee_generations_tenant_id"`);
    await queryRunner.query(`DROP TABLE "fee_generations"`);
    await queryRunner.query(`DROP TYPE "public"."fee_generations_duplicate_strategy_enum"`);
    await queryRunner.query(`DROP TYPE "public"."fee_generations_source_enum"`);
    await queryRunner.query(`DROP TYPE "public"."fee_generations_period_type_enum"`);
  }
}
