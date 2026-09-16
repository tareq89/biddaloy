import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [16.7.1] `recurring_schedules` — saved "generate these fees automatically"
 * definitions — plus its two children: `recurring_schedule_structures`
 * (which fee structures it bills) and `recurring_schedule_exclusions`
 * (students carved out of its audience). Also adds the FK on
 * `fee_generations.recurring_schedule_id`, a column 16.1.4's migration
 * already created as a plain nullable uuid (this entity didn't exist yet
 * at that point).
 */
export class AddRecurringSchedules1789800010000 implements MigrationInterface {
  name = 'AddRecurringSchedules1789800010000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."recurring_schedules_period_type_enum" AS ENUM('MONTH', 'WEEK')`,
    );

    await queryRunner.query(`
      CREATE TABLE "recurring_schedules" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "academic_year_id" uuid NOT NULL,
        "name" varchar(200) NOT NULL,
        "audience" jsonb NOT NULL,
        "rule" jsonb NOT NULL,
        "period_type" "public"."recurring_schedules_period_type_enum" NOT NULL,
        "due_days_after_period_start" integer NOT NULL DEFAULT 9,
        "starts_on" date NOT NULL,
        "ends_on" date NOT NULL,
        "notify_families" boolean NOT NULL DEFAULT true,
        "is_active" boolean NOT NULL DEFAULT true,
        "last_run_period" date,
        "created_by_user_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_recurring_schedules" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_recurring_schedules_tenant_id" ON "recurring_schedules" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_recurring_schedules_tenant_year" ON "recurring_schedules" ("tenant_id", "academic_year_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "recurring_schedules" ADD CONSTRAINT "FK_recurring_schedules_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "recurring_schedules" ADD CONSTRAINT "FK_recurring_schedules_academic_year" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "recurring_schedules" ADD CONSTRAINT "FK_recurring_schedules_created_by" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    await queryRunner.query(`
      CREATE TABLE "recurring_schedule_structures" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "schedule_id" uuid NOT NULL,
        "fee_structure_id" uuid NOT NULL,
        CONSTRAINT "PK_recurring_schedule_structures" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_recurring_schedule_structures_schedule_fee" ON "recurring_schedule_structures" ("schedule_id", "fee_structure_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "recurring_schedule_structures" ADD CONSTRAINT "FK_recurring_schedule_structures_schedule" FOREIGN KEY ("schedule_id") REFERENCES "recurring_schedules"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "recurring_schedule_structures" ADD CONSTRAINT "FK_recurring_schedule_structures_fee_structure" FOREIGN KEY ("fee_structure_id") REFERENCES "fee_structures"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(`
      CREATE TABLE "recurring_schedule_exclusions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "schedule_id" uuid NOT NULL,
        "student_id" uuid NOT NULL,
        "reason" text NOT NULL,
        "created_by_user_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_recurring_schedule_exclusions" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_recurring_schedule_exclusions_schedule_student" ON "recurring_schedule_exclusions" ("schedule_id", "student_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "recurring_schedule_exclusions" ADD CONSTRAINT "FK_recurring_schedule_exclusions_schedule" FOREIGN KEY ("schedule_id") REFERENCES "recurring_schedules"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "recurring_schedule_exclusions" ADD CONSTRAINT "FK_recurring_schedule_exclusions_student" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "recurring_schedule_exclusions" ADD CONSTRAINT "FK_recurring_schedule_exclusions_created_by" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `ALTER TABLE "fee_generations" ADD CONSTRAINT "FK_fee_generations_recurring_schedule" FOREIGN KEY ("recurring_schedule_id") REFERENCES "recurring_schedules"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "fee_generations" DROP CONSTRAINT "FK_fee_generations_recurring_schedule"`,
    );

    await queryRunner.query(`DROP TABLE "recurring_schedule_exclusions"`);
    await queryRunner.query(`DROP TABLE "recurring_schedule_structures"`);

    await queryRunner.query(
      `ALTER TABLE "recurring_schedules" DROP CONSTRAINT "FK_recurring_schedules_created_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "recurring_schedules" DROP CONSTRAINT "FK_recurring_schedules_academic_year"`,
    );
    await queryRunner.query(
      `ALTER TABLE "recurring_schedules" DROP CONSTRAINT "FK_recurring_schedules_tenant"`,
    );
    await queryRunner.query(`DROP TABLE "recurring_schedules"`);

    await queryRunner.query(`DROP TYPE "public"."recurring_schedules_period_type_enum"`);
  }
}
