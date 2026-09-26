import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [23.2.1] Ten tenant-scoped tables for Epic 23.0's staff HR spine. This is
 * the wave's single migration — 23.3/23.4 add `@Entity` classes against the
 * seven dynamic-row tables this migration already creates, with no further
 * migration files in this wave.
 *
 * - `designations` — tenant-editable job-title master list.
 * - `staff_hr_records` — one job-info row per staff `User` (D1: keyed by
 *   `user_id`, not `teacher_id` — HR applies to any staff role, not just
 *   teachers).
 * - `staff_designation_history` — promotion/employment-status history. At
 *   most one open row (`end_date IS NULL`) per `user_id` — the partial
 *   unique index below, same technique as
 *   `1789800001000-StudentFeeAsBill.ts`'s
 *   `IDX_student_fees_late_fee_for_student_fee_id`.
 * - `staff_family_members`, `staff_addresses`, `staff_experience`,
 *   `staff_education`, `staff_training`, `staff_achievements`,
 *   `staff_languages` — the seven dynamic-row sections of a staff profile
 *   (shared/src/dto/staff-hr-record.dto.ts, 23.1). Column shapes come
 *   straight from those DTOs; 23.3/23.4 add the `@Entity` classes.
 */
export class StaffHrCore1789800014000 implements MigrationInterface {
  name = 'StaffHrCore1789800014000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // designations
    await queryRunner.query(`
      CREATE TABLE "designations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "title_en" varchar(200) NOT NULL,
        "title_bn" varchar(200),
        "is_teaching" boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_designations" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_designations_tenant" ON "designations" ("tenant_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "designations" ADD CONSTRAINT "FK_designations_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    // Uniqueness excludes soft-deleted rows, same pattern as
    // `class_subjects`' (class_id, subject_id, academic_year_id) index.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_designations_tenant_title_en" ON "designations" ("tenant_id", "title_en") WHERE "deleted_at" IS NULL`,
    );

    // staff_hr_records
    await queryRunner.query(`
      CREATE TABLE "staff_hr_records" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "index_no" varchar(50),
        "salary_code" varchar(50),
        "mpo_date" date,
        "salary_scale" varchar(50),
        "department" varchar(100),
        "blood_group" varchar(10),
        "religion" varchar(50),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_staff_hr_records" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_staff_hr_records_tenant" ON "staff_hr_records" ("tenant_id")`,
    );
    // One HR record per user PER TENANT (D1) — a user can be staff in more
    // than one tenant/branch, so this must not be a global unique on
    // user_id alone (that would let tenant A's row block tenant B's).
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_staff_hr_records_tenant_user" ON "staff_hr_records" ("tenant_id", "user_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "staff_hr_records" ADD CONSTRAINT "FK_staff_hr_records_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "staff_hr_records" ADD CONSTRAINT "FK_staff_hr_records_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // staff_designation_history
    await queryRunner.query(
      `CREATE TYPE "public"."staff_designation_history_status_enum" AS ENUM('REGULAR', 'IRREGULAR', 'RESIGNED')`,
    );
    await queryRunner.query(`
      CREATE TABLE "staff_designation_history" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "designation_id" uuid NOT NULL,
        "effective_date" date NOT NULL,
        "end_date" date,
        "status" "public"."staff_designation_history_status_enum" NOT NULL,
        "resigned_at" timestamptz,
        "notes" varchar(500),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_staff_designation_history" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_staff_designation_history_tenant" ON "staff_designation_history" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_staff_designation_history_user" ON "staff_designation_history" ("user_id")`,
    );
    // At most one open (current) designation row per user PER TENANT (D7) —
    // same multi-tenant-staff reasoning as the staff_hr_records index above.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_staff_designation_history_open_row" ON "staff_designation_history" ("tenant_id", "user_id") WHERE "end_date" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "staff_designation_history" ADD CONSTRAINT "FK_staff_designation_history_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "staff_designation_history" ADD CONSTRAINT "FK_staff_designation_history_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "staff_designation_history" ADD CONSTRAINT "FK_staff_designation_history_designation" FOREIGN KEY ("designation_id") REFERENCES "designations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );

    // staff_family_members
    await queryRunner.query(`
      CREATE TABLE "staff_family_members" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "staff_user_id" uuid NOT NULL,
        "relation" varchar(100) NOT NULL,
        "name" varchar(200) NOT NULL,
        "occupation" varchar(200),
        "contact" varchar(50),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_staff_family_members" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_staff_family_members_tenant" ON "staff_family_members" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_staff_family_members_staff_user" ON "staff_family_members" ("staff_user_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "staff_family_members" ADD CONSTRAINT "FK_staff_family_members_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "staff_family_members" ADD CONSTRAINT "FK_staff_family_members_staff_user" FOREIGN KEY ("staff_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // staff_addresses
    await queryRunner.query(
      `CREATE TYPE "public"."staff_addresses_type_enum" AS ENUM('PRESENT', 'PERMANENT')`,
    );
    await queryRunner.query(`
      CREATE TABLE "staff_addresses" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "staff_user_id" uuid NOT NULL,
        "type" "public"."staff_addresses_type_enum" NOT NULL,
        "village_street" varchar(200),
        "post_office" varchar(100),
        "upazila" varchar(100),
        "district" varchar(100),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_staff_addresses" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_staff_addresses_tenant" ON "staff_addresses" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_staff_addresses_staff_user" ON "staff_addresses" ("staff_user_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "staff_addresses" ADD CONSTRAINT "FK_staff_addresses_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "staff_addresses" ADD CONSTRAINT "FK_staff_addresses_staff_user" FOREIGN KEY ("staff_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // staff_experience
    await queryRunner.query(`
      CREATE TABLE "staff_experience" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "staff_user_id" uuid NOT NULL,
        "institution" varchar(200) NOT NULL,
        "designation" varchar(200) NOT NULL,
        "from_date" date NOT NULL,
        "to_date" date,
        "description" varchar(1000),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_staff_experience" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_staff_experience_tenant" ON "staff_experience" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_staff_experience_staff_user" ON "staff_experience" ("staff_user_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "staff_experience" ADD CONSTRAINT "FK_staff_experience_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "staff_experience" ADD CONSTRAINT "FK_staff_experience_staff_user" FOREIGN KEY ("staff_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // staff_education
    await queryRunner.query(`
      CREATE TABLE "staff_education" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "staff_user_id" uuid NOT NULL,
        "degree" varchar(200) NOT NULL,
        "institution" varchar(200) NOT NULL,
        "board_university" varchar(200),
        "result" varchar(50),
        "passing_year" varchar(4),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_staff_education" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_staff_education_tenant" ON "staff_education" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_staff_education_staff_user" ON "staff_education" ("staff_user_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "staff_education" ADD CONSTRAINT "FK_staff_education_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "staff_education" ADD CONSTRAINT "FK_staff_education_staff_user" FOREIGN KEY ("staff_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // staff_training
    await queryRunner.query(`
      CREATE TABLE "staff_training" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "staff_user_id" uuid NOT NULL,
        "title" varchar(200) NOT NULL,
        "institution" varchar(200) NOT NULL,
        "from_date" date NOT NULL,
        "to_date" date,
        "certificate_no" varchar(100),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_staff_training" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_staff_training_tenant" ON "staff_training" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_staff_training_staff_user" ON "staff_training" ("staff_user_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "staff_training" ADD CONSTRAINT "FK_staff_training_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "staff_training" ADD CONSTRAINT "FK_staff_training_staff_user" FOREIGN KEY ("staff_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // staff_achievements
    await queryRunner.query(`
      CREATE TABLE "staff_achievements" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "staff_user_id" uuid NOT NULL,
        "title" varchar(200) NOT NULL,
        "description" varchar(1000),
        "date" date,
        "issued_by" varchar(200),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_staff_achievements" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_staff_achievements_tenant" ON "staff_achievements" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_staff_achievements_staff_user" ON "staff_achievements" ("staff_user_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "staff_achievements" ADD CONSTRAINT "FK_staff_achievements_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "staff_achievements" ADD CONSTRAINT "FK_staff_achievements_staff_user" FOREIGN KEY ("staff_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // staff_languages
    await queryRunner.query(`
      CREATE TABLE "staff_languages" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "staff_user_id" uuid NOT NULL,
        "language_name" varchar(100) NOT NULL,
        "proficiency" varchar(50),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_staff_languages" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_staff_languages_tenant" ON "staff_languages" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_staff_languages_staff_user" ON "staff_languages" ("staff_user_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "staff_languages" ADD CONSTRAINT "FK_staff_languages_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "staff_languages" ADD CONSTRAINT "FK_staff_languages_staff_user" FOREIGN KEY ("staff_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse order of creation for FKs.
    await queryRunner.query(
      `ALTER TABLE "staff_languages" DROP CONSTRAINT "FK_staff_languages_staff_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE "staff_languages" DROP CONSTRAINT "FK_staff_languages_tenant"`,
    );
    await queryRunner.query(`DROP TABLE "staff_languages"`);

    await queryRunner.query(
      `ALTER TABLE "staff_achievements" DROP CONSTRAINT "FK_staff_achievements_staff_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE "staff_achievements" DROP CONSTRAINT "FK_staff_achievements_tenant"`,
    );
    await queryRunner.query(`DROP TABLE "staff_achievements"`);

    await queryRunner.query(
      `ALTER TABLE "staff_training" DROP CONSTRAINT "FK_staff_training_staff_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE "staff_training" DROP CONSTRAINT "FK_staff_training_tenant"`,
    );
    await queryRunner.query(`DROP TABLE "staff_training"`);

    await queryRunner.query(
      `ALTER TABLE "staff_education" DROP CONSTRAINT "FK_staff_education_staff_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE "staff_education" DROP CONSTRAINT "FK_staff_education_tenant"`,
    );
    await queryRunner.query(`DROP TABLE "staff_education"`);

    await queryRunner.query(
      `ALTER TABLE "staff_experience" DROP CONSTRAINT "FK_staff_experience_staff_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE "staff_experience" DROP CONSTRAINT "FK_staff_experience_tenant"`,
    );
    await queryRunner.query(`DROP TABLE "staff_experience"`);

    await queryRunner.query(
      `ALTER TABLE "staff_addresses" DROP CONSTRAINT "FK_staff_addresses_staff_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE "staff_addresses" DROP CONSTRAINT "FK_staff_addresses_tenant"`,
    );
    await queryRunner.query(`DROP TABLE "staff_addresses"`);
    await queryRunner.query(`DROP TYPE "public"."staff_addresses_type_enum"`);

    await queryRunner.query(
      `ALTER TABLE "staff_family_members" DROP CONSTRAINT "FK_staff_family_members_staff_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE "staff_family_members" DROP CONSTRAINT "FK_staff_family_members_tenant"`,
    );
    await queryRunner.query(`DROP TABLE "staff_family_members"`);

    await queryRunner.query(
      `ALTER TABLE "staff_designation_history" DROP CONSTRAINT "FK_staff_designation_history_designation"`,
    );
    await queryRunner.query(
      `ALTER TABLE "staff_designation_history" DROP CONSTRAINT "FK_staff_designation_history_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE "staff_designation_history" DROP CONSTRAINT "FK_staff_designation_history_tenant"`,
    );
    await queryRunner.query(`DROP INDEX "public"."UQ_staff_designation_history_open_row"`);
    await queryRunner.query(`DROP TABLE "staff_designation_history"`);
    await queryRunner.query(`DROP TYPE "public"."staff_designation_history_status_enum"`);

    await queryRunner.query(
      `ALTER TABLE "staff_hr_records" DROP CONSTRAINT "FK_staff_hr_records_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE "staff_hr_records" DROP CONSTRAINT "FK_staff_hr_records_tenant"`,
    );
    await queryRunner.query(`DROP INDEX "public"."UQ_staff_hr_records_tenant_user"`);
    await queryRunner.query(`DROP TABLE "staff_hr_records"`);

    await queryRunner.query(`ALTER TABLE "designations" DROP CONSTRAINT "FK_designations_tenant"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_designations_tenant_title_en"`);
    await queryRunner.query(`DROP TABLE "designations"`);
  }
}
