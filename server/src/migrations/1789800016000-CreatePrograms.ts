import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [34.1.2] Four tenant-scoped tables for Epic 34.0's programs/milestones
 * spine:
 *
 * - `programs` — a tenant-wide program (e.g. a hifz or scouting track); no
 *   `academic_year_id` — programs aren't year-scoped (D2).
 * - `program_milestones` — ordered milestones within a program, D15.
 * - `program_enrollments` — a student's enrollment in a program; only one
 *   ACTIVE enrollment per (program, student) at a time, D19.
 * - `milestone_achievements` — a student's achievement of one milestone
 *   within their enrollment.
 */
export class CreatePrograms1789800016000 implements MigrationInterface {
  name = 'CreatePrograms1789800016000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // programs
    await queryRunner.query(`
      CREATE TABLE "programs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "name" varchar(200) NOT NULL,
        "description" text,
        "is_active" boolean NOT NULL DEFAULT true,
        "show_on_report_card" boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_programs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_programs_tenant" ON "programs" ("tenant_id")`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_programs_tenant_name" ON "programs" ("tenant_id", "name")`,
    );
    await queryRunner.query(
      `ALTER TABLE "programs" ADD CONSTRAINT "FK_programs_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // program_milestones
    await queryRunner.query(`
      CREATE TABLE "program_milestones" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "program_id" uuid NOT NULL,
        "name" varchar(200) NOT NULL,
        "description" text,
        "sequence" integer NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_program_milestones" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_program_milestones_program_sequence" UNIQUE ("program_id", "sequence") DEFERRABLE INITIALLY DEFERRED
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_program_milestones_tenant_program" ON "program_milestones" ("tenant_id", "program_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "program_milestones" ADD CONSTRAINT "FK_program_milestones_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "program_milestones" ADD CONSTRAINT "FK_program_milestones_program" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // program_enrollments
    await queryRunner.query(
      `CREATE TYPE "public"."program_enrollments_status_enum" AS ENUM('ACTIVE', 'COMPLETED', 'WITHDRAWN')`,
    );
    await queryRunner.query(`
      CREATE TABLE "program_enrollments" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "program_id" uuid NOT NULL,
        "student_id" uuid NOT NULL,
        "started_on" date NOT NULL,
        "ended_on" date,
        "status" "public"."program_enrollments_status_enum" NOT NULL DEFAULT 'ACTIVE',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_program_enrollments" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_program_enrollments_tenant_program" ON "program_enrollments" ("tenant_id", "program_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_program_enrollments_tenant_student" ON "program_enrollments" ("tenant_id", "student_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_program_enrollments_program_student_active" ON "program_enrollments" ("program_id", "student_id") WHERE "status" = 'ACTIVE'`,
    );
    await queryRunner.query(
      `ALTER TABLE "program_enrollments" ADD CONSTRAINT "FK_program_enrollments_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "program_enrollments" ADD CONSTRAINT "FK_program_enrollments_program" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "program_enrollments" ADD CONSTRAINT "FK_program_enrollments_student" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // milestone_achievements
    await queryRunner.query(`
      CREATE TABLE "milestone_achievements" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "enrollment_id" uuid NOT NULL,
        "milestone_id" uuid NOT NULL,
        "achieved_on" date NOT NULL,
        "recorded_by" uuid,
        "score" numeric(6,2),
        "grade" varchar(50),
        "remark" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_milestone_achievements" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_milestone_achievements_enrollment_milestone" UNIQUE ("enrollment_id", "milestone_id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_milestone_achievements_tenant_enrollment" ON "milestone_achievements" ("tenant_id", "enrollment_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "milestone_achievements" ADD CONSTRAINT "FK_milestone_achievements_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "milestone_achievements" ADD CONSTRAINT "FK_milestone_achievements_enrollment" FOREIGN KEY ("enrollment_id") REFERENCES "program_enrollments"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "milestone_achievements" ADD CONSTRAINT "FK_milestone_achievements_milestone" FOREIGN KEY ("milestone_id") REFERENCES "program_milestones"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "milestone_achievements" ADD CONSTRAINT "FK_milestone_achievements_recorded_by" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // milestone_achievements
    await queryRunner.query(
      `ALTER TABLE "milestone_achievements" DROP CONSTRAINT "FK_milestone_achievements_recorded_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "milestone_achievements" DROP CONSTRAINT "FK_milestone_achievements_milestone"`,
    );
    await queryRunner.query(
      `ALTER TABLE "milestone_achievements" DROP CONSTRAINT "FK_milestone_achievements_enrollment"`,
    );
    await queryRunner.query(
      `ALTER TABLE "milestone_achievements" DROP CONSTRAINT "FK_milestone_achievements_tenant"`,
    );
    await queryRunner.query(`DROP TABLE "milestone_achievements"`);

    // program_enrollments
    await queryRunner.query(
      `ALTER TABLE "program_enrollments" DROP CONSTRAINT "FK_program_enrollments_student"`,
    );
    await queryRunner.query(
      `ALTER TABLE "program_enrollments" DROP CONSTRAINT "FK_program_enrollments_program"`,
    );
    await queryRunner.query(
      `ALTER TABLE "program_enrollments" DROP CONSTRAINT "FK_program_enrollments_tenant"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_program_enrollments_program_student_active"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_program_enrollments_tenant_student"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_program_enrollments_tenant_program"`);
    await queryRunner.query(`DROP TABLE "program_enrollments"`);
    await queryRunner.query(`DROP TYPE "public"."program_enrollments_status_enum"`);

    // program_milestones
    await queryRunner.query(
      `ALTER TABLE "program_milestones" DROP CONSTRAINT "FK_program_milestones_program"`,
    );
    await queryRunner.query(
      `ALTER TABLE "program_milestones" DROP CONSTRAINT "FK_program_milestones_tenant"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_program_milestones_tenant_program"`);
    await queryRunner.query(`DROP TABLE "program_milestones"`);

    // programs
    await queryRunner.query(`ALTER TABLE "programs" DROP CONSTRAINT "FK_programs_tenant"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_programs_tenant_name"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_programs_tenant"`);
    await queryRunner.query(`DROP TABLE "programs"`);
  }
}
