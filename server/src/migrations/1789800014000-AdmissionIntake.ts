import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [27.1] `admission_intakes` (an admission window opened for one class
 * section), `admission_applicants` (candidates applying against an intake)
 * and `admission_evaluations` (append-only reviewer decisions on an
 * applicant). Schema-only ticket — no service/controller yet.
 *
 * `admission_intakes` has no `status` column: OPEN/CLOSED is derived from
 * `open_date`/`close_date` on read, not persisted.
 */
export class AdmissionIntake1789800014000 implements MigrationInterface {
  name = 'AdmissionIntake1789800014000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "admission_intakes" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "class_section_id" uuid NOT NULL,
        "title" varchar(200) NOT NULL,
        "seat_count" int NOT NULL,
        "open_date" date NOT NULL,
        "close_date" date NOT NULL,
        "required_document_types" jsonb NOT NULL DEFAULT '[]',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_admission_intakes" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_admission_intakes_tenant_section" ON "admission_intakes" ("tenant_id", "class_section_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "admission_intakes" ADD CONSTRAINT "FK_admission_intakes_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "admission_intakes" ADD CONSTRAINT "FK_admission_intakes_class_section" FOREIGN KEY ("class_section_id") REFERENCES "class_sections"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(`
      CREATE TABLE "admission_applicants" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "intake_id" uuid NOT NULL,
        "reference_number" varchar(50) NOT NULL,
        "applicant_name" varchar(200) NOT NULL,
        "date_of_birth" date NOT NULL,
        "gender" varchar(20) NOT NULL,
        "guardian_name" varchar(200) NOT NULL,
        "guardian_phone" varchar(20) NOT NULL,
        "guardian_email" varchar(200),
        "home_address" text,
        "documents" jsonb NOT NULL DEFAULT '[]',
        "status" varchar(20) NOT NULL DEFAULT 'PENDING',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_admission_applicants" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_admission_applicants_tenant_intake" ON "admission_applicants" ("tenant_id", "intake_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_admission_applicants_reference_number" ON "admission_applicants" ("tenant_id", "reference_number")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_admission_applicants_intake_phone" ON "admission_applicants" ("tenant_id", "intake_id", "guardian_phone") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "admission_applicants" ADD CONSTRAINT "FK_admission_applicants_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "admission_applicants" ADD CONSTRAINT "FK_admission_applicants_intake" FOREIGN KEY ("intake_id") REFERENCES "admission_intakes"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(`
      CREATE TABLE "admission_evaluations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "applicant_id" uuid NOT NULL,
        "reviewer_user_id" uuid NOT NULL,
        "notes" text NOT NULL,
        "decision" varchar(20),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_admission_evaluations" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_admission_evaluations_tenant_applicant" ON "admission_evaluations" ("tenant_id", "applicant_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "admission_evaluations" ADD CONSTRAINT "FK_admission_evaluations_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "admission_evaluations" ADD CONSTRAINT "FK_admission_evaluations_applicant" FOREIGN KEY ("applicant_id") REFERENCES "admission_applicants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "admission_evaluations" DROP CONSTRAINT "FK_admission_evaluations_applicant"`,
    );
    await queryRunner.query(
      `ALTER TABLE "admission_evaluations" DROP CONSTRAINT "FK_admission_evaluations_tenant"`,
    );
    await queryRunner.query(`DROP TABLE "admission_evaluations"`);

    await queryRunner.query(
      `ALTER TABLE "admission_applicants" DROP CONSTRAINT "FK_admission_applicants_intake"`,
    );
    await queryRunner.query(
      `ALTER TABLE "admission_applicants" DROP CONSTRAINT "FK_admission_applicants_tenant"`,
    );
    await queryRunner.query(`DROP TABLE "admission_applicants"`);

    await queryRunner.query(
      `ALTER TABLE "admission_intakes" DROP CONSTRAINT "FK_admission_intakes_class_section"`,
    );
    await queryRunner.query(
      `ALTER TABLE "admission_intakes" DROP CONSTRAINT "FK_admission_intakes_tenant"`,
    );
    await queryRunner.query(`DROP TABLE "admission_intakes"`);
  }
}
