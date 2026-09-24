import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [22.2.1] Four tenant-scoped tables for Epic 22.0's homework/syllabus
 * spine:
 *
 * - `homework` — one homework given for a subject/class.
 * - `homework_assignments` — who it's assigned to: a whole section or one
 *   student, never both, never neither (D24) — enforced by a CHECK
 *   constraint, same convention as `marks`' CHK in
 *   `1789800012000-AddExamsMarksResults.ts`.
 * - `homework_submissions` — one row per (assignment, student), D19.
 * - `syllabus_topics` — ordered topics per class/subject, D19.
 */
export class CreateHomeworkAndSyllabus1789800013000 implements MigrationInterface {
  name = 'CreateHomeworkAndSyllabus1789800013000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // homework
    await queryRunner.query(
      `CREATE TYPE "public"."homework_grading_mode_enum" AS ENUM('TICK', 'PARTIAL', 'MARKS')`,
    );
    await queryRunner.query(`
      CREATE TABLE "homework" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "subject_id" uuid NOT NULL,
        "class_id" uuid NOT NULL,
        "title" varchar(200) NOT NULL,
        "description" text,
        "grading_mode" "public"."homework_grading_mode_enum" NOT NULL,
        "attachments" jsonb NOT NULL DEFAULT '[]',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_homework" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_homework_tenant" ON "homework" ("tenant_id")`);
    await queryRunner.query(
      `ALTER TABLE "homework" ADD CONSTRAINT "FK_homework_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "homework" ADD CONSTRAINT "FK_homework_subject" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "homework" ADD CONSTRAINT "FK_homework_class" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // homework_assignments
    await queryRunner.query(
      `CREATE TYPE "public"."homework_assignments_status_enum" AS ENUM('ACTIVE', 'DEACTIVATED', 'SUPERSEDED')`,
    );
    await queryRunner.query(`
      CREATE TABLE "homework_assignments" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "homework_id" uuid NOT NULL,
        "section_id" uuid,
        "student_id" uuid,
        "assigned_date" date NOT NULL,
        "due_date" date NOT NULL,
        "status" "public"."homework_assignments_status_enum" NOT NULL DEFAULT 'ACTIVE',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_homework_assignments" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_homework_assignments_exactly_one_target" CHECK (("section_id" IS NULL) <> ("student_id" IS NULL))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_homework_assignments_tenant" ON "homework_assignments" ("tenant_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "homework_assignments" ADD CONSTRAINT "FK_homework_assignments_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "homework_assignments" ADD CONSTRAINT "FK_homework_assignments_homework" FOREIGN KEY ("homework_id") REFERENCES "homework"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "homework_assignments" ADD CONSTRAINT "FK_homework_assignments_section" FOREIGN KEY ("section_id") REFERENCES "class_sections"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "homework_assignments" ADD CONSTRAINT "FK_homework_assignments_student" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // homework_submissions
    await queryRunner.query(
      `CREATE TYPE "public"."homework_submissions_status_enum" AS ENUM('NOT_SUBMITTED', 'SUBMITTED', 'PARTIAL', 'DONE')`,
    );
    await queryRunner.query(`
      CREATE TABLE "homework_submissions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "assignment_id" uuid NOT NULL,
        "student_id" uuid NOT NULL,
        "status" "public"."homework_submissions_status_enum" NOT NULL DEFAULT 'NOT_SUBMITTED',
        "marks" integer,
        "attachments" jsonb NOT NULL DEFAULT '[]',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_homework_submissions" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_homework_submissions_tenant" ON "homework_submissions" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_homework_submissions_assignment_student" ON "homework_submissions" ("assignment_id", "student_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "homework_submissions" ADD CONSTRAINT "FK_homework_submissions_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "homework_submissions" ADD CONSTRAINT "FK_homework_submissions_assignment" FOREIGN KEY ("assignment_id") REFERENCES "homework_assignments"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "homework_submissions" ADD CONSTRAINT "FK_homework_submissions_student" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // syllabus_topics
    await queryRunner.query(
      `CREATE TYPE "public"."syllabus_topics_status_enum" AS ENUM('PLANNED', 'IN_PROGRESS', 'DONE')`,
    );
    await queryRunner.query(`
      CREATE TABLE "syllabus_topics" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "class_id" uuid NOT NULL,
        "subject_id" uuid NOT NULL,
        "name" varchar(200) NOT NULL,
        "description" text,
        "sequence" integer NOT NULL,
        "status" "public"."syllabus_topics_status_enum" NOT NULL DEFAULT 'PLANNED',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_syllabus_topics" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_syllabus_topics_tenant" ON "syllabus_topics" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_syllabus_topics_class_subject" ON "syllabus_topics" ("class_id", "subject_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "syllabus_topics" ADD CONSTRAINT "FK_syllabus_topics_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "syllabus_topics" ADD CONSTRAINT "FK_syllabus_topics_class" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "syllabus_topics" ADD CONSTRAINT "FK_syllabus_topics_subject" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // syllabus_topics
    await queryRunner.query(
      `ALTER TABLE "syllabus_topics" DROP CONSTRAINT "FK_syllabus_topics_subject"`,
    );
    await queryRunner.query(
      `ALTER TABLE "syllabus_topics" DROP CONSTRAINT "FK_syllabus_topics_class"`,
    );
    await queryRunner.query(
      `ALTER TABLE "syllabus_topics" DROP CONSTRAINT "FK_syllabus_topics_tenant"`,
    );
    await queryRunner.query(`DROP TABLE "syllabus_topics"`);
    await queryRunner.query(`DROP TYPE "public"."syllabus_topics_status_enum"`);

    // homework_submissions
    await queryRunner.query(
      `ALTER TABLE "homework_submissions" DROP CONSTRAINT "FK_homework_submissions_student"`,
    );
    await queryRunner.query(
      `ALTER TABLE "homework_submissions" DROP CONSTRAINT "FK_homework_submissions_assignment"`,
    );
    await queryRunner.query(
      `ALTER TABLE "homework_submissions" DROP CONSTRAINT "FK_homework_submissions_tenant"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_homework_submissions_assignment_student"`);
    await queryRunner.query(`DROP TABLE "homework_submissions"`);
    await queryRunner.query(`DROP TYPE "public"."homework_submissions_status_enum"`);

    // homework_assignments
    await queryRunner.query(
      `ALTER TABLE "homework_assignments" DROP CONSTRAINT "FK_homework_assignments_student"`,
    );
    await queryRunner.query(
      `ALTER TABLE "homework_assignments" DROP CONSTRAINT "FK_homework_assignments_section"`,
    );
    await queryRunner.query(
      `ALTER TABLE "homework_assignments" DROP CONSTRAINT "FK_homework_assignments_homework"`,
    );
    await queryRunner.query(
      `ALTER TABLE "homework_assignments" DROP CONSTRAINT "FK_homework_assignments_tenant"`,
    );
    await queryRunner.query(`DROP TABLE "homework_assignments"`);
    await queryRunner.query(`DROP TYPE "public"."homework_assignments_status_enum"`);

    // homework
    await queryRunner.query(`ALTER TABLE "homework" DROP CONSTRAINT "FK_homework_class"`);
    await queryRunner.query(`ALTER TABLE "homework" DROP CONSTRAINT "FK_homework_subject"`);
    await queryRunner.query(`ALTER TABLE "homework" DROP CONSTRAINT "FK_homework_tenant"`);
    await queryRunner.query(`DROP TABLE "homework"`);
    await queryRunner.query(`DROP TYPE "public"."homework_grading_mode_enum"`);
  }
}
