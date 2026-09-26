import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [36.1.1] Foundation for staff attendance & leave: a generic `staff_profiles`
 * row every staff `User` (TEACHER/ADMIN/ACCOUNTANT/EXECUTIVE) gets, plus the
 * tables the rest of Epic 36 builds on — `staff_attendance_sessions`,
 * `staff_attendance_records`, `leave_policies`, `leave_records`.
 *
 * `up()` order is FK-forced:
 *   1. enum types (`leave_type_enum`, `leave_status_enum` — new; the
 *      attendance status/source enums already exist from [9.2] and are
 *      reused as-is, same PRESENT/ABSENT/LATE/LEAVE and
 *      TEACHER/DEVICE/IMPORT/SYSTEM sets).
 *   2. `staff_profiles` (depends on `users`/`schools`).
 *   3. `teachers.staff_profile_id`, added nullable so the column can exist
 *      before any row has a value to put in it.
 *   4. Backfill: every existing `Teacher` row gets a `staff_profiles` row
 *      reusing its `employee_id`/`joining_date`; every other staff user
 *      (ADMIN/ACCOUNTANT/EXECUTIVE, or a TEACHER-role user with no `Teacher`
 *      row) gets one with a generated `EMP-<tenant_short>-<sequence>` id.
 *   5. `teachers.staff_profile_id` backfilled from the rows just inserted,
 *      then set `NOT NULL` — the column is never nullable once the
 *      migration finishes, only mid-migration.
 *   6. `staff_attendance_sessions`, `staff_attendance_records` (depend on
 *      `staff_profiles`).
 *   7. `leave_policies`, seeded with the D9 defaults for every existing
 *      tenant, then `leave_records` (depends on `staff_profiles`).
 */
export class StaffAttendanceLeave1789800014000 implements MigrationInterface {
  name = 'StaffAttendanceLeave1789800014000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Enum types
    await queryRunner.query(
      `CREATE TYPE "public"."leave_type_enum" AS ENUM('CASUAL', 'SICK', 'MATERNITY', 'PATERNITY', 'EARNED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."leave_status_enum" AS ENUM('PENDING', 'APPROVED', 'REJECTED')`,
    );

    // 2. staff_profiles
    await queryRunner.query(`
      CREATE TABLE "staff_profiles" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "employee_id" varchar(50) NOT NULL,
        "joining_date" date,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_staff_profiles" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_staff_profiles_user" UNIQUE ("user_id"),
        CONSTRAINT "UQ_staff_profiles_tenant_employee_id" UNIQUE ("tenant_id", "employee_id"),
        CONSTRAINT "FK_staff_profiles_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_staff_profiles_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_staff_profiles_tenant_id" ON "staff_profiles" ("tenant_id")`,
    );

    // 3. teachers.staff_profile_id — nullable until the backfill below fills it.
    await queryRunner.query(`ALTER TABLE "teachers" ADD "staff_profile_id" uuid`);

    // 4a. Backfill: every existing Teacher row reuses its own employee_id/joining_date.
    await queryRunner.query(`
      INSERT INTO "staff_profiles" ("id", "user_id", "tenant_id", "employee_id", "joining_date", "created_at", "updated_at")
      SELECT gen_random_uuid(), "t"."user_id", "t"."tenant_id", "t"."employee_id", "t"."joining_date", now(), now()
      FROM "teachers" "t"
      WHERE NOT EXISTS (SELECT 1 FROM "staff_profiles" "sp" WHERE "sp"."user_id" = "t"."user_id")
    `);

    // 4b. Backfill: every other staff user (TEACHER-role with no Teacher row,
    // or ADMIN/ACCOUNTANT/EXECUTIVE) gets a generated employee_id, unique per
    // tenant via a per-tenant sequence. One membership row per user is picked
    // deterministically (a user with several tenant memberships gets exactly
    // one staff_profiles row, per the plan's `user_id` unique constraint).
    await queryRunner.query(`
      WITH "eligible" AS (
        SELECT DISTINCT ON ("ut"."user_id") "ut"."user_id", "ut"."tenant_id"
        FROM "user_tenants" "ut"
        WHERE "ut"."role" IN ('TEACHER', 'ADMIN', 'ACCOUNTANT', 'EXECUTIVE')
          AND NOT EXISTS (SELECT 1 FROM "staff_profiles" "sp" WHERE "sp"."user_id" = "ut"."user_id")
        ORDER BY "ut"."user_id", "ut"."tenant_id"
      ),
      "numbered" AS (
        SELECT "user_id", "tenant_id",
          ROW_NUMBER() OVER (PARTITION BY "tenant_id" ORDER BY "user_id") AS "seq"
        FROM "eligible"
      )
      INSERT INTO "staff_profiles" ("id", "user_id", "tenant_id", "employee_id", "joining_date", "created_at", "updated_at")
      SELECT gen_random_uuid(), "user_id", "tenant_id",
        'EMP-' || substring("tenant_id"::text, 1, 8) || '-' || "seq",
        NULL, now(), now()
      FROM "numbered"
    `);

    // 5. teachers.staff_profile_id backfilled, then locked NOT NULL.
    await queryRunner.query(`
      UPDATE "teachers" "t" SET "staff_profile_id" = "sp"."id"
      FROM "staff_profiles" "sp"
      WHERE "sp"."user_id" = "t"."user_id"
    `);
    await queryRunner.query(`ALTER TABLE "teachers" ALTER COLUMN "staff_profile_id" SET NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE "teachers" ADD CONSTRAINT "FK_teachers_staff_profile" FOREIGN KEY ("staff_profile_id") REFERENCES "staff_profiles"("id") ON DELETE CASCADE`,
    );

    // 6. staff_attendance_sessions
    await queryRunner.query(`
      CREATE TABLE "staff_attendance_sessions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "date" date NOT NULL,
        "version" int NOT NULL DEFAULT 1,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_staff_attendance_sessions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_staff_attendance_sessions_tenant_date" UNIQUE ("tenant_id", "date"),
        CONSTRAINT "FK_staff_attendance_sessions_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_staff_attendance_sessions_tenant_date" ON "staff_attendance_sessions" ("tenant_id", "date")`,
    );

    // 7. staff_attendance_records — status/source reuse the [9.2] enum types.
    await queryRunner.query(`
      CREATE TABLE "staff_attendance_records" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "session_id" uuid NOT NULL,
        "staff_profile_id" uuid NOT NULL,
        "status" "public"."attendance_status_enum" NOT NULL,
        "source" "public"."attendance_source_enum" NOT NULL DEFAULT 'TEACHER',
        "check_in_at" timestamptz,
        "check_out_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_staff_attendance_records" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_staff_attendance_records_session_staff" UNIQUE ("session_id", "staff_profile_id"),
        CONSTRAINT "FK_staff_attendance_records_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_staff_attendance_records_session" FOREIGN KEY ("session_id") REFERENCES "staff_attendance_sessions"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_staff_attendance_records_staff_profile" FOREIGN KEY ("staff_profile_id") REFERENCES "staff_profiles"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_staff_attendance_records_tenant_id" ON "staff_attendance_records" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_staff_attendance_records_staff_profile" ON "staff_attendance_records" ("staff_profile_id")`,
    );

    // 8a. leave_policies, seeded with the D9 defaults for every existing tenant.
    await queryRunner.query(`
      CREATE TABLE "leave_policies" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "leave_type" "public"."leave_type_enum" NOT NULL,
        "annual_quota_days" int NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_leave_policies" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_leave_policies_tenant_type" UNIQUE ("tenant_id", "leave_type"),
        CONSTRAINT "FK_leave_policies_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      INSERT INTO "leave_policies" ("id", "tenant_id", "leave_type", "annual_quota_days", "created_at", "updated_at")
      SELECT gen_random_uuid(), "s"."id", "v"."leave_type", "v"."quota", now(), now()
      FROM "schools" "s"
      CROSS JOIN (VALUES
        ('CASUAL'::"public"."leave_type_enum", 10),
        ('SICK'::"public"."leave_type_enum", 14),
        ('EARNED'::"public"."leave_type_enum", 15),
        ('MATERNITY'::"public"."leave_type_enum", 112),
        ('PATERNITY'::"public"."leave_type_enum", 7)
      ) AS "v"("leave_type", "quota")
    `);

    // 8b. leave_records
    await queryRunner.query(`
      CREATE TABLE "leave_records" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "staff_profile_id" uuid NOT NULL,
        "leave_type" "public"."leave_type_enum" NOT NULL,
        "start_date" date NOT NULL,
        "end_date" date NOT NULL,
        "days" int NOT NULL,
        "status" "public"."leave_status_enum" NOT NULL DEFAULT 'PENDING',
        "reason" varchar(255),
        "approved_by" uuid,
        "decided_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_leave_records" PRIMARY KEY ("id"),
        CONSTRAINT "FK_leave_records_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_leave_records_staff_profile" FOREIGN KEY ("staff_profile_id") REFERENCES "staff_profiles"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_leave_records_approved_by" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_leave_records_tenant_id" ON "leave_records" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_leave_records_staff_profile" ON "leave_records" ("staff_profile_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_leave_records_staff_profile"`);
    await queryRunner.query(`DROP INDEX "IDX_leave_records_tenant_id"`);
    await queryRunner.query(`DROP TABLE "leave_records"`);

    await queryRunner.query(`DROP TABLE "leave_policies"`);

    await queryRunner.query(`DROP INDEX "IDX_staff_attendance_records_staff_profile"`);
    await queryRunner.query(`DROP INDEX "IDX_staff_attendance_records_tenant_id"`);
    await queryRunner.query(`DROP TABLE "staff_attendance_records"`);

    await queryRunner.query(`DROP INDEX "IDX_staff_attendance_sessions_tenant_date"`);
    await queryRunner.query(`DROP TABLE "staff_attendance_sessions"`);

    await queryRunner.query(`ALTER TABLE "teachers" DROP CONSTRAINT "FK_teachers_staff_profile"`);
    await queryRunner.query(`ALTER TABLE "teachers" DROP COLUMN "staff_profile_id"`);

    await queryRunner.query(`DROP INDEX "IDX_staff_profiles_tenant_id"`);
    await queryRunner.query(`DROP TABLE "staff_profiles"`);

    await queryRunner.query(`DROP TYPE "public"."leave_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."leave_type_enum"`);
  }
}
