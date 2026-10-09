import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [35.1.3/#1266] `exam_templates` + `exam_template_components` (a reusable
 * set of per-class/per-subject exam components) and the nullable
 * `class_subjects.group_name`. Reuses the existing `exams_kind_enum` and
 * `exam_components_kind_enum` pg types — neither is created or dropped here.
 */
export class AddExamTemplatesAndClassSubjectGroup1791000000000 implements MigrationInterface {
  name = 'AddExamTemplatesAndClassSubjectGroup1791000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "exam_templates" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "name" varchar(200) NOT NULL,
        "kind" "public"."exams_kind_enum" NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_exam_templates" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_exam_templates_tenant" ON "exam_templates" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_exam_templates_tenant_name" ON "exam_templates" ("tenant_id", "name") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "exam_templates" ADD CONSTRAINT "FK_exam_templates_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(`
      CREATE TABLE "exam_template_components" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "template_id" uuid NOT NULL,
        "class_grade" int NOT NULL,
        "subject_code" varchar(20) NOT NULL,
        "sequence" int NOT NULL,
        "name" varchar(200) NOT NULL,
        "kind" "public"."exam_components_kind_enum" NOT NULL,
        "full_marks" numeric(6,2) NOT NULL,
        "pass_marks" numeric(6,2) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_exam_template_components" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_exam_template_components_marks" CHECK ("full_marks" > 0 AND "pass_marks" >= 0 AND "pass_marks" <= "full_marks")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_exam_template_components_tenant_template" ON "exam_template_components" ("tenant_id", "template_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_exam_template_components_natural" ON "exam_template_components" ("template_id", "class_grade", "subject_code", "name")`,
    );
    await queryRunner.query(
      `ALTER TABLE "exam_template_components" ADD CONSTRAINT "FK_exam_template_components_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "exam_template_components" ADD CONSTRAINT "FK_exam_template_components_template" FOREIGN KEY ("template_id") REFERENCES "exam_templates"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(`ALTER TABLE "class_subjects" ADD COLUMN "group_name" varchar(50)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "class_subjects" DROP COLUMN "group_name"`);
    await queryRunner.query(`DROP TABLE "exam_template_components"`);
    await queryRunner.query(`DROP TABLE "exam_templates"`);
  }
}
