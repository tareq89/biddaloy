import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [52.1.2] Applications (Epic 52): `applications` + `application_events` +
 * `application_tags` + `application_attachments`, nullable leave quota (D19),
 * `leave_records.application_id` and the `CANCELLED` leave status (D31).
 * PENDING leave rows are moved by the next migration, not here.
 */
export class Applications1791600000000 implements MigrationInterface {
  name = 'Applications1791600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."applications_type_enum" AS ENUM('STAFF_LEAVE', 'STUDENT_LEAVE', 'FEE_WAIVER', 'TESTIMONIAL', 'TRANSFER_CERTIFICATE', 'READMISSION', 'SECTION_CHANGE', 'SCRIPT_RECHECK', 'ID_CARD_REPRINT', 'GENERAL')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."applications_status_enum" AS ENUM('PENDING', 'UNDER_CONSIDERATION', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'CANCELLED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."applications_source_enum" AS ENUM('APP', 'PAPER')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."applications_addressee_enum" AS ENUM('CLASS_TEACHER', 'HEADMASTER', 'OFFICE', 'STAFF_USER')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."application_events_kind_enum" AS ENUM('SUBMITTED', 'STEP_APPROVED', 'APPROVED', 'REJECTED', 'UNDER_CONSIDERATION', 'WITHDRAWN', 'CANCELLED', 'COMMENT', 'TAGGED')`,
    );

    await queryRunner.query(`
      CREATE TABLE "applications" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "type" "public"."applications_type_enum" NOT NULL,
        "status" "public"."applications_status_enum" NOT NULL DEFAULT 'PENDING',
        "source" "public"."applications_source_enum" NOT NULL DEFAULT 'APP',
        "serial_year" int NOT NULL,
        "serial_no" int NOT NULL,
        "academic_year_id" uuid,
        "applicant_user_id" uuid,
        "applicant_name" varchar(150),
        "entered_by_user_id" uuid,
        "subject_student_id" uuid,
        "subject_staff_profile_id" uuid,
        "payload" jsonb NOT NULL DEFAULT '{}',
        "start_date" date,
        "end_date" date,
        "addressee" "public"."applications_addressee_enum",
        "addressee_user_id" uuid,
        "current_step" int NOT NULL DEFAULT 0,
        "letter_text" text NOT NULL,
        "letter_locale" varchar(8) NOT NULL,
        "granted" jsonb,
        "effect_result" jsonb,
        "decided_by_user_id" uuid,
        "decided_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_applications" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_applications_tenant_serial" UNIQUE ("tenant_id", "serial_year", "serial_no"),
        CONSTRAINT "UQ_applications_tenant_id" UNIQUE ("tenant_id", "id"),
        CONSTRAINT "CHK_applications_one_subject" CHECK (num_nonnulls("subject_student_id", "subject_staff_profile_id") = 1),
        CONSTRAINT "CHK_applications_applicant" CHECK ("applicant_user_id" IS NOT NULL OR ("source" = 'PAPER' AND "applicant_name" IS NOT NULL)),
        CONSTRAINT "FK_applications_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_applications_academic_year" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_applications_subject_student" FOREIGN KEY ("subject_student_id") REFERENCES "students"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_applications_subject_staff" FOREIGN KEY ("subject_staff_profile_id") REFERENCES "staff_profiles"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_applications_applicant" FOREIGN KEY ("applicant_user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_applications_entered_by" FOREIGN KEY ("entered_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_applications_addressee_user" FOREIGN KEY ("addressee_user_id") REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_applications_decided_by" FOREIGN KEY ("decided_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_applications_tenant_status_type" ON "applications" ("tenant_id", "status", "type")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_applications_tenant_subject_student" ON "applications" ("tenant_id", "subject_student_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_applications_tenant_subject_staff" ON "applications" ("tenant_id", "subject_staff_profile_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_applications_tenant_applicant" ON "applications" ("tenant_id", "applicant_user_id")`,
    );
    // Inbox: "addressed to me" (D12, D49).
    await queryRunner.query(
      `CREATE INDEX "IDX_applications_tenant_addressee_user" ON "applications" ("tenant_id", "addressee_user_id") WHERE "addressee_user_id" IS NOT NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE "application_events" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "application_id" uuid NOT NULL,
        "actor_user_id" uuid NOT NULL,
        "kind" "public"."application_events_kind_enum" NOT NULL,
        "step" int,
        "note" text,
        "data" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_application_events" PRIMARY KEY ("id"),
        CONSTRAINT "FK_application_events_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_application_events_application" FOREIGN KEY ("tenant_id", "application_id") REFERENCES "applications"("tenant_id", "id") ON DELETE CASCADE,
        CONSTRAINT "FK_application_events_actor" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_application_events_tenant_application" ON "application_events" ("tenant_id", "application_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "application_tags" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "application_id" uuid NOT NULL,
        "user_id" uuid,
        "role" varchar(32),
        "created_by_user_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_application_tags" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_application_tags_user_xor_role" CHECK (num_nonnulls("user_id", "role") = 1),
        CONSTRAINT "CHK_application_tags_role" CHECK ("role" IN ('ADMIN', 'ACCOUNTANT', 'TEACHER', 'EXECUTIVE', 'OFFICE_STAFF', 'EXAM_CONTROLLER', 'COMMITTEE')),
        CONSTRAINT "FK_application_tags_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_application_tags_application" FOREIGN KEY ("tenant_id", "application_id") REFERENCES "applications"("tenant_id", "id") ON DELETE CASCADE,
        CONSTRAINT "FK_application_tags_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_application_tags_created_by" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_application_tags_tenant_application" ON "application_tags" ("tenant_id", "application_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_application_tags_user" ON "application_tags" ("application_id", "user_id") WHERE "user_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_application_tags_role" ON "application_tags" ("application_id", "role") WHERE "role" IS NOT NULL`,
    );
    // Inbox: "tagged to me" by person or by role (D14).
    await queryRunner.query(
      `CREATE INDEX "IDX_application_tags_tenant_user" ON "application_tags" ("tenant_id", "user_id") WHERE "user_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_application_tags_tenant_role" ON "application_tags" ("tenant_id", "role") WHERE "role" IS NOT NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE "application_attachments" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "application_id" uuid NOT NULL,
        "storage_key" varchar(512) NOT NULL,
        "file_name" varchar(255) NOT NULL,
        "mime_type" varchar(100) NOT NULL,
        "size_bytes" int NOT NULL,
        "uploaded_by_user_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_application_attachments" PRIMARY KEY ("id"),
        CONSTRAINT "FK_application_attachments_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_application_attachments_application" FOREIGN KEY ("tenant_id", "application_id") REFERENCES "applications"("tenant_id", "id") ON DELETE CASCADE,
        CONSTRAINT "FK_application_attachments_uploaded_by" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_application_attachments_tenant_application" ON "application_attachments" ("tenant_id", "application_id")`,
    );

    // Leave changes
    await queryRunner.query(
      `ALTER TABLE "leave_policies" ALTER COLUMN "annual_quota_days" DROP NOT NULL`,
    );
    await queryRunner.query(`ALTER TABLE "leave_records" ADD "application_id" uuid`);
    await queryRunner.query(
      // Composite tenant FK like the child tables. SET NULL names its column (PG 15+, as in
      // PrintModule) so deleting an application nulls only application_id, never tenant_id.
      `ALTER TABLE "leave_records" ADD CONSTRAINT "FK_leave_records_application" FOREIGN KEY ("tenant_id", "application_id") REFERENCES "applications"("tenant_id", "id") ON DELETE SET NULL ("application_id")`,
    );
    // TypeORM runs a whole deploy batch in one transaction, and PG refuses a new enum value
    // in the transaction that added it. A later migration that WRITES 'CANCELLED' must run
    // in a separate deploy, or set `transaction = false` on itself.
    await queryRunner.query(
      `ALTER TYPE "public"."leave_status_enum" ADD VALUE IF NOT EXISTS 'CANCELLED'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Fails loudly (by design) if a leave_records row is CANCELLED: the old
    // enum cannot represent it. Same precedent as AddLoginFailedAuditAction.
    await queryRunner.query(`ALTER TABLE "leave_records" ALTER COLUMN "status" DROP DEFAULT`);
    await queryRunner.query(
      `ALTER TYPE "public"."leave_status_enum" RENAME TO "leave_status_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."leave_status_enum" AS ENUM('PENDING', 'APPROVED', 'REJECTED')`,
    );
    await queryRunner.query(
      `ALTER TABLE "leave_records" ALTER COLUMN "status" TYPE "public"."leave_status_enum" USING "status"::text::"public"."leave_status_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "leave_records" ALTER COLUMN "status" SET DEFAULT 'PENDING'`,
    );
    await queryRunner.query(`DROP TYPE "public"."leave_status_enum_old"`);

    await queryRunner.query(
      `ALTER TABLE "leave_records" DROP CONSTRAINT "FK_leave_records_application"`,
    );
    await queryRunner.query(`ALTER TABLE "leave_records" DROP COLUMN "application_id"`);
    // Fails loudly (by design) if a policy is NULL = unlimited (D19): turning it into 0
    // would silently block every approval of that leave type.
    await queryRunner.query(
      `ALTER TABLE "leave_policies" ALTER COLUMN "annual_quota_days" SET NOT NULL`,
    );

    await queryRunner.query(`DROP TABLE "application_attachments"`);
    await queryRunner.query(`DROP TABLE "application_tags"`);
    await queryRunner.query(`DROP TABLE "application_events"`);
    await queryRunner.query(`DROP TABLE "applications"`);
    await queryRunner.query(`DROP TYPE "public"."application_events_kind_enum"`);
    await queryRunner.query(`DROP TYPE "public"."applications_addressee_enum"`);
    await queryRunner.query(`DROP TYPE "public"."applications_source_enum"`);
    await queryRunner.query(`DROP TYPE "public"."applications_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."applications_type_enum"`);
  }
}
