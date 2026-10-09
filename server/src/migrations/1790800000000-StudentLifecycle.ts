import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [39.1.2]/#1183 — student-lifecycle schema (Epic 39): `student_lifecycle_events`
 * (append-only, D20), `student_notes`, `student_public_exams`, five new
 * `students` columns, and a backfill of one event per existing non-ACTIVE
 * enrollment (D23).
 */
export class StudentLifecycle1790800000000 implements MigrationInterface {
  name = 'StudentLifecycle1790800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."student_lifecycle_events_event_type_enum" AS ENUM('WITHDRAWN', 'TRANSFERRED_OUT', 'GRADUATED', 'READMITTED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."student_public_exams_exam_type_enum" AS ENUM('PSC', 'JSC', 'SSC', 'DAKHIL', 'HSC', 'ALIM')`,
    );

    await queryRunner.query(`
      CREATE TABLE "student_lifecycle_events" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "student_id" uuid NOT NULL,
        "enrollment_id" uuid NOT NULL,
        "academic_year_id" uuid NOT NULL,
        "event_type" "public"."student_lifecycle_events_event_type_enum" NOT NULL,
        "occurred_on" date NOT NULL,
        "reason" text NOT NULL,
        "destination" text,
        "remark" text,
        "recorded_by_user_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_student_lifecycle_events" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_student_lifecycle_events_tenant_student_date" ON "student_lifecycle_events" ("tenant_id", "student_id", "occurred_on")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_student_lifecycle_events_tenant_year_type" ON "student_lifecycle_events" ("tenant_id", "academic_year_id", "event_type")`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_lifecycle_events" ADD CONSTRAINT "FK_student_lifecycle_events_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_lifecycle_events" ADD CONSTRAINT "FK_student_lifecycle_events_student" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_lifecycle_events" ADD CONSTRAINT "FK_student_lifecycle_events_enrollment" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_lifecycle_events" ADD CONSTRAINT "FK_student_lifecycle_events_academic_year" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    await queryRunner.query(`
      CREATE TABLE "student_notes" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "student_id" uuid NOT NULL,
        "author_user_id" uuid NOT NULL,
        "body" text NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_student_notes" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_student_notes_tenant_student" ON "student_notes" ("tenant_id", "student_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_notes" ADD CONSTRAINT "FK_student_notes_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_notes" ADD CONSTRAINT "FK_student_notes_student" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    await queryRunner.query(`
      CREATE TABLE "student_public_exams" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "student_id" uuid NOT NULL,
        "exam_type" "public"."student_public_exams_exam_type_enum" NOT NULL,
        "board" text NOT NULL,
        "roll_no" character varying(50) NOT NULL,
        "registration_no" character varying(50) NOT NULL,
        "gpa" numeric(3,2),
        "passing_year" integer NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_student_public_exams" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_student_public_exams_tenant_student" ON "student_public_exams" ("tenant_id", "student_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_public_exams" ADD CONSTRAINT "FK_student_public_exams_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_public_exams" ADD CONSTRAINT "FK_student_public_exams_student" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    await queryRunner.query(`ALTER TABLE "students" ADD "religion" character varying`);
    await queryRunner.query(`ALTER TABLE "students" ADD "birth_reg_no" character varying`);
    await queryRunner.query(`ALTER TABLE "students" ADD "health_notes" text`);
    await queryRunner.query(`ALTER TABLE "students" ADD "father_name" character varying`);
    await queryRunner.query(`ALTER TABLE "students" ADD "mother_name" character varying`);
    // Partial unique: one birth-registration number per school, ignoring
    // students without one and soft-deleted rows. Mirrored on the entity's @Index.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_students_tenant_birth_reg_no"
        ON "students" ("tenant_id", "birth_reg_no")
        WHERE "birth_reg_no" IS NOT NULL AND "deleted_at" IS NULL
    `);

    // D23: one event per existing non-ACTIVE enrollment.
    await queryRunner.query(`
      INSERT INTO "student_lifecycle_events"
        ("tenant_id", "student_id", "enrollment_id", "academic_year_id", "event_type",
         "occurred_on", "reason", "remark", "recorded_by_user_id")
      SELECT e."tenant_id", e."student_id", e."id", e."academic_year_id",
        CASE e."enrollment_status"
          WHEN 'INACTIVE' THEN 'WITHDRAWN'
          WHEN 'TRANSFERRED' THEN 'TRANSFERRED_OUT'
          WHEN 'GRADUATED' THEN 'GRADUATED'
        END::"public"."student_lifecycle_events_event_type_enum",
        e."updated_at"::date, 'backfilled', 'backfilled', NULL
      FROM "enrollments" e
      WHERE e."enrollment_status" IN ('INACTIVE', 'TRANSFERRED', 'GRADUATED')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_students_tenant_birth_reg_no"`);
    await queryRunner.query(`ALTER TABLE "students" DROP COLUMN "mother_name"`);
    await queryRunner.query(`ALTER TABLE "students" DROP COLUMN "father_name"`);
    await queryRunner.query(`ALTER TABLE "students" DROP COLUMN "health_notes"`);
    await queryRunner.query(`ALTER TABLE "students" DROP COLUMN "birth_reg_no"`);
    await queryRunner.query(`ALTER TABLE "students" DROP COLUMN "religion"`);

    await queryRunner.query(`DROP TABLE IF EXISTS "student_public_exams"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "student_notes"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "student_lifecycle_events"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."student_public_exams_exam_type_enum"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."student_lifecycle_events_event_type_enum"`,
    );
  }
}
