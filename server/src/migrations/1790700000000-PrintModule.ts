import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [32.1.2] Print module tables (Epic 32 D17, D38, D40, D44, D56) plus the
 * student / staff columns the templates read (D15, D41, D48).
 * `print_template_versions` is immutable once written (UPDATE blocked by
 * trigger); `print_jobs` / `print_job_items` are the print audit trail.
 */
export class PrintModule1790700000000 implements MigrationInterface {
  name = 'PrintModule1790700000000';

  public async up(q: QueryRunner): Promise<void> {
    const tenantFk = (t: string) =>
      `ALTER TABLE "${t}" ADD CONSTRAINT "FK_${t}_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`;
    const userFk = (t: string, col: string) =>
      `ALTER TABLE "${t}" ADD CONSTRAINT "FK_${t}_${col}" FOREIGN KEY ("${col}") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`;

    // ---- print_templates ----
    await q.query(`
      CREATE TABLE "print_templates" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "document_kind" varchar(40) NOT NULL,
        "layout_kind" varchar(20) NOT NULL DEFAULT 'FIXED',
        "name" varchar(120) NOT NULL,
        "is_default" boolean NOT NULL DEFAULT false,
        "batch_size" int NOT NULL DEFAULT 50,
        "draft" jsonb NOT NULL,
        "current_version_id" uuid,
        "created_by" uuid,
        "archived_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_print_templates" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_print_templates_tenant_id" UNIQUE ("tenant_id", "id"),
        CONSTRAINT "CHK_print_templates_batch_size" CHECK ("batch_size" BETWEEN 1 AND 200)
      )
    `);
    await q.query(`CREATE INDEX "IDX_print_templates_tenant" ON "print_templates" ("tenant_id")`);
    await q.query(
      `CREATE UNIQUE INDEX "UQ_print_templates_default_per_kind" ON "print_templates" ("tenant_id", "document_kind") WHERE "is_default" AND "archived_at" IS NULL`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "UQ_print_templates_name" ON "print_templates" ("tenant_id", lower("name")) WHERE "archived_at" IS NULL`,
    );
    await q.query(tenantFk('print_templates'));
    await q.query(userFk('print_templates', 'created_by'));

    // ---- print_template_versions ----
    await q.query(`
      CREATE TABLE "print_template_versions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "template_id" uuid NOT NULL,
        "version" int NOT NULL,
        "definition" jsonb NOT NULL,
        "published_by" uuid,
        "published_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_print_template_versions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_print_template_versions_tenant_id" UNIQUE ("tenant_id", "id"),
        CONSTRAINT "UQ_print_template_versions_template_version" UNIQUE ("template_id", "version")
      )
    `);
    await q.query(
      `CREATE INDEX "IDX_print_template_versions_tenant" ON "print_template_versions" ("tenant_id")`,
    );
    await q.query(tenantFk('print_template_versions'));
    await q.query(
      `ALTER TABLE "print_template_versions" ADD CONSTRAINT "FK_print_template_versions_template" FOREIGN KEY ("tenant_id", "template_id") REFERENCES "print_templates"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await q.query(userFk('print_template_versions', 'published_by'));
    await q.query(
      `ALTER TABLE "print_templates" ADD CONSTRAINT "FK_print_templates_current_version" FOREIGN KEY ("tenant_id", "current_version_id") REFERENCES "print_template_versions"("tenant_id", "id") ON DELETE SET NULL ("current_version_id") ON UPDATE NO ACTION`,
    );
    await q.query(
      `CREATE OR REPLACE FUNCTION "public"."block_print_template_versions_update"() RETURNS TRIGGER AS $$ BEGIN RAISE EXCEPTION 'print_template_versions is immutable: updates are not permitted'; END; $$ LANGUAGE plpgsql`,
    );
    await q.query(
      `CREATE TRIGGER "trg_print_template_versions_immutable" BEFORE UPDATE ON "print_template_versions" FOR EACH ROW EXECUTE FUNCTION "public"."block_print_template_versions_update"()`,
    );

    // ---- print_assets ----
    await q.query(`
      CREATE TABLE "print_assets" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "asset_kind" varchar(20) NOT NULL,
        "storage_key" varchar(255) NOT NULL,
        "content_type" varchar(100) NOT NULL,
        "byte_size" int NOT NULL,
        "width_px" int,
        "height_px" int,
        "font_family" varchar(100),
        "original_name" varchar(255) NOT NULL,
        "uploaded_by" uuid,
        "archived_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_print_assets" PRIMARY KEY ("id")
      )
    `);
    await q.query(`CREATE INDEX "IDX_print_assets_tenant" ON "print_assets" ("tenant_id")`);
    await q.query(tenantFk('print_assets'));
    await q.query(userFk('print_assets', 'uploaded_by'));

    // ---- printer_profiles ----
    await q.query(`
      CREATE TABLE "printer_profiles" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "name" varchar(80) NOT NULL,
        "printer_type" varchar(20) NOT NULL,
        "margin_top_mm" numeric(5,2) NOT NULL DEFAULT 0,
        "margin_right_mm" numeric(5,2) NOT NULL DEFAULT 0,
        "margin_bottom_mm" numeric(5,2) NOT NULL DEFAULT 0,
        "margin_left_mm" numeric(5,2) NOT NULL DEFAULT 0,
        "offset_x_mm" numeric(5,2) NOT NULL DEFAULT 0,
        "offset_y_mm" numeric(5,2) NOT NULL DEFAULT 0,
        "scale" numeric(5,4) NOT NULL DEFAULT 1,
        "duplex_order" varchar(20) NOT NULL DEFAULT 'INTERLEAVED',
        "sheet_gap_mm" numeric(5,2) NOT NULL DEFAULT 2,
        "archived_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_printer_profiles" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_printer_profiles_tenant_id" UNIQUE ("tenant_id", "id"),
        CONSTRAINT "CHK_printer_profiles_scale" CHECK ("scale" BETWEEN 0.9 AND 1.1)
      )
    `);
    await q.query(`CREATE INDEX "IDX_printer_profiles_tenant" ON "printer_profiles" ("tenant_id")`);
    await q.query(
      `CREATE UNIQUE INDEX "UQ_printer_profiles_name" ON "printer_profiles" ("tenant_id", lower("name")) WHERE "archived_at" IS NULL`,
    );
    await q.query(tenantFk('printer_profiles'));

    // ---- print_jobs ----
    await q.query(`
      CREATE TABLE "print_jobs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "template_version_id" uuid NOT NULL,
        "document_kind" varchar(40) NOT NULL,
        "printer_profile_id" uuid,
        "printer_name" varchar(80),
        "printed_by" uuid,
        "item_count" int NOT NULL,
        "status" varchar(20) NOT NULL DEFAULT 'OPEN',
        "confirmed_at" timestamptz,
        "batch_label" varchar(120),
        "reprint_of_job_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_print_jobs" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_print_jobs_tenant_id" UNIQUE ("tenant_id", "id")
      )
    `);
    await q.query(
      `CREATE INDEX "IDX_print_jobs_tenant_created" ON "print_jobs" ("tenant_id", "created_at" DESC)`,
    );
    await q.query(tenantFk('print_jobs'));
    await q.query(
      `ALTER TABLE "print_jobs" ADD CONSTRAINT "FK_print_jobs_template_version" FOREIGN KEY ("tenant_id", "template_version_id") REFERENCES "print_template_versions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await q.query(
      `ALTER TABLE "print_jobs" ADD CONSTRAINT "FK_print_jobs_printer_profile" FOREIGN KEY ("tenant_id", "printer_profile_id") REFERENCES "printer_profiles"("tenant_id", "id") ON DELETE SET NULL ("printer_profile_id") ON UPDATE NO ACTION`,
    );
    await q.query(userFk('print_jobs', 'printed_by'));
    await q.query(
      `ALTER TABLE "print_jobs" ADD CONSTRAINT "FK_print_jobs_reprint_of" FOREIGN KEY ("tenant_id", "reprint_of_job_id") REFERENCES "print_jobs"("tenant_id", "id") ON DELETE SET NULL ("reprint_of_job_id") ON UPDATE NO ACTION`,
    );

    // ---- print_job_items ----
    await q.query(`
      CREATE TABLE "print_job_items" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "job_id" uuid NOT NULL,
        "document_kind" varchar(40) NOT NULL,
        "subject_type" varchar(20) NOT NULL,
        "subject_id" uuid,
        "subject_label" varchar(200) NOT NULL,
        "copy_number" int NOT NULL,
        "data_snapshot" jsonb NOT NULL,
        "verify_token_hash" char(64) NOT NULL,
        "outcome" varchar(20) NOT NULL DEFAULT 'PENDING',
        "revoked_at" timestamptz,
        "revoked_by" uuid,
        "revoke_reason" varchar(280),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_print_job_items" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_print_job_items_verify_token" UNIQUE ("verify_token_hash"),
        CONSTRAINT "UQ_print_job_items_copy" UNIQUE NULLS NOT DISTINCT ("tenant_id", "subject_type", "subject_id", "document_kind", "copy_number")
      )
    `);
    await q.query(`CREATE INDEX "IDX_print_job_items_tenant" ON "print_job_items" ("tenant_id")`);
    await q.query(
      `CREATE INDEX "IDX_print_job_items_subject" ON "print_job_items" ("tenant_id", "subject_type", "subject_id")`,
    );
    await q.query(tenantFk('print_job_items'));
    await q.query(
      `ALTER TABLE "print_job_items" ADD CONSTRAINT "FK_print_job_items_job" FOREIGN KEY ("tenant_id", "job_id") REFERENCES "print_jobs"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await q.query(userFk('print_job_items', 'revoked_by'));

    // ---- people columns ----
    await q.query(`ALTER TABLE "students" ADD COLUMN "photo_key" varchar(255)`);
    await q.query(`ALTER TABLE "students" ADD COLUMN "full_name_bn" varchar(200)`);
    await q.query(`ALTER TABLE "students" ADD COLUMN "blood_group" varchar(10)`);
    await q.query(`ALTER TABLE "staff_hr_records" ADD COLUMN "name_bn" varchar(200)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "staff_hr_records" DROP COLUMN "name_bn"`);
    await q.query(`ALTER TABLE "students" DROP COLUMN "blood_group"`);
    await q.query(`ALTER TABLE "students" DROP COLUMN "full_name_bn"`);
    await q.query(`ALTER TABLE "students" DROP COLUMN "photo_key"`);
    await q.query(`DROP TABLE "print_job_items"`);
    await q.query(`DROP TABLE "print_jobs"`);
    await q.query(`DROP TABLE "printer_profiles"`);
    await q.query(`DROP TABLE "print_assets"`);
    await q.query(
      `ALTER TABLE "print_templates" DROP CONSTRAINT "FK_print_templates_current_version"`,
    );
    await q.query(`DROP TABLE "print_template_versions"`);
    await q.query(`DROP FUNCTION "public"."block_print_template_versions_update"()`);
    await q.query(`DROP TABLE "print_templates"`);
  }
}
