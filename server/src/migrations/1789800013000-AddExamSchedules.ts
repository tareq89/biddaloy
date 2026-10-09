import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [19.11.1] `exam_schedules` — one subject's sitting within one exam: date,
 * start/end time, optional free-text venue. See `ExamSchedule`'s docstring
 * for why `venue` is text rather than a `rooms` FK.
 */
export class AddExamSchedules1789800013000 implements MigrationInterface {
  name = 'AddExamSchedules1789800013000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "exam_schedules" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "exam_id" uuid NOT NULL,
        "subject_id" uuid NOT NULL,
        "date" date NOT NULL,
        "starts_at" time NOT NULL,
        "ends_at" time NOT NULL,
        "venue" varchar(200),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_exam_schedules" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_exam_schedules_tenant_exam" ON "exam_schedules" ("tenant_id", "exam_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_exam_schedules_exam_subject" ON "exam_schedules" ("exam_id", "subject_id") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "exam_schedules" ADD CONSTRAINT "FK_exam_schedules_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "exam_schedules" ADD CONSTRAINT "FK_exam_schedules_exam" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "exam_schedules" ADD CONSTRAINT "FK_exam_schedules_subject" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "exam_schedules" DROP CONSTRAINT "FK_exam_schedules_subject"`,
    );
    await queryRunner.query(
      `ALTER TABLE "exam_schedules" DROP CONSTRAINT "FK_exam_schedules_exam"`,
    );
    await queryRunner.query(
      `ALTER TABLE "exam_schedules" DROP CONSTRAINT "FK_exam_schedules_tenant"`,
    );
    await queryRunner.query(`DROP TABLE "exam_schedules"`);
  }
}
