import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [Epic 71 / #4171] Admission pipeline: round settings on `admission_intakes`, applicant extras,
 * and the stage / stage-result / list / list-member / fee-proof tables.
 *
 * Old rounds become apply-only: one `NONE` stage each, `template_key = 'APPLY_ONLY'`, applicants'
 * `fee_state = 'NONE'`. Reference numbers and statuses are untouched.
 * `class_section_id` is relaxed to nullable (pipeline rounds pick the section at admit time).
 * `class_id` / `academic_year_id` are backfilled through the section's class; they stay nullable
 * until the service ticket sets them on create. Every new table leads its indexes with `tenant_id`.
 * Demo seed rows land in #4175.
 */
export class AdmissionPipeline1792300000000 implements MigrationInterface {
  name = 'AdmissionPipeline1792300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "admission_intakes" ALTER COLUMN "class_section_id" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "admission_intakes"
        ADD COLUMN "class_id" uuid,
        ADD COLUMN "academic_year_id" uuid,
        ADD COLUMN "template_key" varchar(20) NOT NULL DEFAULT 'APPLY_ONLY',
        ADD COLUMN "roll_prefix" varchar(20),
        ADD COLUMN "roll_counter" integer NOT NULL DEFAULT 0,
        ADD COLUMN "fee_amount_paisa" bigint,
        ADD COLUMN "fee_pay_methods" jsonb NOT NULL DEFAULT '[]',
        ADD COLUMN "form_fields" jsonb NOT NULL DEFAULT '[]',
        ADD COLUMN "publish_channels" jsonb NOT NULL DEFAULT '[]',
        ADD COLUMN "tie_break" jsonb NOT NULL DEFAULT '[]',
        ADD COLUMN "show_names_publicly" boolean NOT NULL DEFAULT false,
        ADD COLUMN "widget_always_show" boolean NOT NULL DEFAULT false,
        ADD COLUMN "auto_activate_lists" boolean NOT NULL DEFAULT false,
        ADD CONSTRAINT "CHK_admission_intakes_fee_amount" CHECK ("fee_amount_paisa" IS NULL OR "fee_amount_paisa" >= 0),
        ADD CONSTRAINT "FK_bb332cb90e0c6c556c8d37a74c6" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE RESTRICT,
        ADD CONSTRAINT "FK_447405a01921c831b413ebbed9f" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `UPDATE "admission_intakes" i SET "class_id" = c."id", "academic_year_id" = c."academic_year_id"
         FROM "class_sections" cs JOIN "classes" c ON c."id" = cs."class_id"
        WHERE cs."id" = i."class_section_id" AND i."class_id" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "admission_applicants"
        ADD COLUMN "roll_number" varchar(30),
        ADD COLUMN "source" varchar(10) NOT NULL DEFAULT 'ONLINE',
        ADD COLUMN "quota_tags" jsonb NOT NULL DEFAULT '[]',
        ADD COLUMN "extra_fields" jsonb NOT NULL DEFAULT '{}',
        ADD COLUMN "fee_state" varchar(20) NOT NULL DEFAULT 'NONE',
        ADD COLUMN "merit_rank" integer,
        ADD COLUMN "sibling_student_id" uuid`,
    );
    await queryRunner.query(
      `CREATE TABLE "admission_stages" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "intake_id" uuid NOT NULL,
        "position" integer NOT NULL,
        "kind" varchar(20) NOT NULL,
        "title" varchar(200),
        "config" jsonb NOT NULL DEFAULT '{}',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_admission_stages" PRIMARY KEY ("id"),
        CONSTRAINT "FK_0b8395314a9b19461572d1c1f3c" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_30e0454324fb55d89a28ef432ba" FOREIGN KEY ("intake_id") REFERENCES "admission_intakes"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE TABLE "admission_stage_results" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "stage_id" uuid NOT NULL,
        "applicant_id" uuid NOT NULL,
        "score" numeric(8,2),
        "passed" boolean,
        "remarks" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_admission_stage_results" PRIMARY KEY ("id"),
        CONSTRAINT "FK_8c0e66868bf7a9baca8d2fe04f5" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_6f0b79743ac5b017cb3e47a5e43" FOREIGN KEY ("stage_id") REFERENCES "admission_stages"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_8576353dbc6c6a2a862a6166408" FOREIGN KEY ("applicant_id") REFERENCES "admission_applicants"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE TABLE "admission_lists" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "intake_id" uuid NOT NULL,
        "kind" varchar(20) NOT NULL,
        "sequence" integer NOT NULL,
        "order_by" varchar(20) NOT NULL,
        "active" boolean NOT NULL DEFAULT false,
        "published_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_admission_lists" PRIMARY KEY ("id"),
        CONSTRAINT "FK_62002935d45bb0010016dac28f2" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_5db9ddb2ca1d7ffa91b16bbf4fe" FOREIGN KEY ("intake_id") REFERENCES "admission_intakes"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE TABLE "admission_list_members" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "list_id" uuid NOT NULL,
        "applicant_id" uuid NOT NULL,
        "position" integer NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_admission_list_members" PRIMARY KEY ("id"),
        CONSTRAINT "FK_f4caa492bea28ad57e191098264" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_2327d10cada31abf97cf3c9b2ad" FOREIGN KEY ("list_id") REFERENCES "admission_lists"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_f8abd823c63c7dec78d4170026b" FOREIGN KEY ("applicant_id") REFERENCES "admission_applicants"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE TABLE "admission_fee_proofs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "applicant_id" uuid NOT NULL,
        "attachment_key" text NOT NULL,
        "method" varchar(20) NOT NULL,
        "reference" varchar(100),
        "state" varchar(20) NOT NULL DEFAULT 'AWAITING',
        "verified_by_user_id" uuid,
        "reason" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_admission_fee_proofs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_393b0d1e8daef07c7b911301d99" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_4d5bf80435f818c3ebac2e3318f" FOREIGN KEY ("applicant_id") REFERENCES "admission_applicants"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_c76765db4b336cacee63189c9b0" FOREIGN KEY ("verified_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_admission_stages_position" ON "admission_stages" ("tenant_id","intake_id","position") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_admission_stage_results_applicant" ON "admission_stage_results" ("tenant_id","stage_id","applicant_id") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_admission_lists_sequence" ON "admission_lists" ("tenant_id","intake_id","kind","sequence") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_admission_list_members_applicant" ON "admission_list_members" ("tenant_id","list_id","applicant_id") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_80829effe9127ea18a5729af52" ON "admission_fee_proofs" ("tenant_id","applicant_id")`,
    );

    // One NONE stage per old round; idempotent (skips a round that already has a stage).
    await queryRunner.query(
      `INSERT INTO "admission_stages" ("tenant_id", "intake_id", "position", "kind")
       SELECT i."tenant_id", i."id", 1, 'NONE' FROM "admission_intakes" i
        WHERE NOT EXISTS (SELECT 1 FROM "admission_stages" s WHERE s."intake_id" = i."id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const t of [
      'admission_fee_proofs',
      'admission_list_members',
      'admission_lists',
      'admission_stage_results',
      'admission_stages',
    ]) {
      await queryRunner.query(`DROP TABLE "${t}"`);
    }
    await queryRunner.query(
      `ALTER TABLE "admission_applicants"
        DROP COLUMN "sibling_student_id", DROP COLUMN "merit_rank", DROP COLUMN "fee_state",
        DROP COLUMN "extra_fields", DROP COLUMN "quota_tags", DROP COLUMN "source", DROP COLUMN "roll_number"`,
    );
    await queryRunner.query(
      `ALTER TABLE "admission_intakes"
        DROP CONSTRAINT "FK_447405a01921c831b413ebbed9f", DROP CONSTRAINT "FK_bb332cb90e0c6c556c8d37a74c6",
        DROP CONSTRAINT "CHK_admission_intakes_fee_amount",
        DROP COLUMN "auto_activate_lists", DROP COLUMN "widget_always_show", DROP COLUMN "show_names_publicly",
        DROP COLUMN "tie_break", DROP COLUMN "publish_channels", DROP COLUMN "form_fields",
        DROP COLUMN "fee_pay_methods", DROP COLUMN "fee_amount_paisa", DROP COLUMN "roll_counter",
        DROP COLUMN "roll_prefix", DROP COLUMN "template_key", DROP COLUMN "academic_year_id", DROP COLUMN "class_id"`,
    );
    // Pipeline rounds (no section) cannot satisfy NOT NULL; remove them with their applicants first.
    await queryRunner.query(
      `DELETE FROM "admission_evaluations" WHERE "applicant_id" IN (SELECT a."id" FROM "admission_applicants" a JOIN "admission_intakes" i ON i."id" = a."intake_id" WHERE i."class_section_id" IS NULL)`,
    );
    await queryRunner.query(
      `DELETE FROM "admission_applicants" WHERE "intake_id" IN (SELECT "id" FROM "admission_intakes" WHERE "class_section_id" IS NULL)`,
    );
    await queryRunner.query(`DELETE FROM "admission_intakes" WHERE "class_section_id" IS NULL`);
    await queryRunner.query(
      `ALTER TABLE "admission_intakes" ALTER COLUMN "class_section_id" SET NOT NULL`,
    );
  }
}
