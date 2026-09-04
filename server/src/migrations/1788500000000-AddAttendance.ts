import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [9.2] Adds the attendance domain: `school_holidays` (academics/calendar
 * concern, not attendance — [9.4] reads it), `attendance_devices`,
 * `attendance_sessions`, `attendance_records`, `attendance_device_events`.
 *
 * `up()` order is FK-forced: enum types first, then `school_holidays`
 * (only depends on `schools`/`academic_years`, both pre-existing), then
 * `attendance_devices` (depends on `schools`/`class_sections`), then
 * `attendance_sessions` (depends on `class_sections`/`subjects`/`users`),
 * then `attendance_records` (depends on `attendance_sessions`/`students`/
 * `attendance_devices`), then `attendance_device_events` (depends on
 * `attendance_devices`/`students`/`attendance_records`).
 *
 * Two indexes can't be expressed with TypeORM's `@Index` decorator and are
 * raw SQL here: `UQ_att_session` uses `COALESCE` so two whole-day sessions
 * (`period_no IS NULL`) for the same section/date collide as if
 * `period_no = -1`; `school_holidays`' `CHECK` constraint is a table
 * constraint, not an index.
 */
export class AddAttendance1788500000000 implements MigrationInterface {
  name = 'AddAttendance1788500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Enum types
    await queryRunner.query(
      `CREATE TYPE "public"."attendance_status_enum" AS ENUM('PRESENT', 'ABSENT', 'LATE', 'LEAVE')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."attendance_source_enum" AS ENUM('TEACHER', 'DEVICE', 'IMPORT', 'SYSTEM')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."attendance_session_state_enum" AS ENUM('DRAFT', 'FINALIZED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."attendance_device_kind_enum" AS ENUM('BIOMETRIC', 'FACE', 'RFID', 'OTHER')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."attendance_device_status_enum" AS ENUM('ACTIVE', 'REVOKED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."attendance_event_direction_enum" AS ENUM('IN', 'OUT')`,
    );

    // 2. school_holidays
    await queryRunner.query(`
      CREATE TABLE "school_holidays" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "academic_year_id" uuid NOT NULL,
        "start_date" date NOT NULL,
        "end_date" date NOT NULL,
        "name" varchar(120) NOT NULL,
        "counts_as_working_day" boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_school_holidays" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_school_holidays_date_range" CHECK ("start_date" <= "end_date"),
        CONSTRAINT "FK_school_holidays_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_school_holidays_academic_year" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_school_holidays_tenant_dates" ON "school_holidays" ("tenant_id", "start_date", "end_date")`,
    );

    // 3. attendance_devices
    await queryRunner.query(`
      CREATE TABLE "attendance_devices" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "name" varchar(100) NOT NULL,
        "kind" "public"."attendance_device_kind_enum" NOT NULL,
        "token_hash" varchar(64) NOT NULL,
        "token_last4" varchar(4) NOT NULL,
        "section_id" uuid,
        "roster_access" boolean NOT NULL DEFAULT false,
        "status" "public"."attendance_device_status_enum" NOT NULL DEFAULT 'ACTIVE',
        "last_seen_at" timestamptz,
        "revoked_at" timestamptz,
        "created_by_user_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_attendance_devices" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_attendance_devices_token_hash" UNIQUE ("token_hash"),
        CONSTRAINT "FK_attendance_devices_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_attendance_devices_section" FOREIGN KEY ("section_id") REFERENCES "class_sections"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_attendance_devices_created_by" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_attendance_devices_tenant_id" ON "attendance_devices" ("tenant_id")`,
    );

    // 4. attendance_sessions
    await queryRunner.query(`
      CREATE TABLE "attendance_sessions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "section_id" uuid NOT NULL,
        "date" date NOT NULL,
        "period_no" smallint,
        "subject_id" uuid,
        "state" "public"."attendance_session_state_enum" NOT NULL DEFAULT 'DRAFT',
        "version" int NOT NULL DEFAULT 1,
        "source" "public"."attendance_source_enum" NOT NULL DEFAULT 'TEACHER',
        "last_client_request_id" uuid,
        "marked_by_user_id" uuid,
        "marked_at" timestamptz,
        "finalized_at" timestamptz,
        "notified_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_attendance_sessions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_attendance_sessions_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_attendance_sessions_section" FOREIGN KEY ("section_id") REFERENCES "class_sections"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_attendance_sessions_subject" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_attendance_sessions_marked_by" FOREIGN KEY ("marked_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_attendance_sessions_tenant_date" ON "attendance_sessions" ("tenant_id", "date")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_attendance_sessions_section_date" ON "attendance_sessions" ("section_id", "date")`,
    );
    // COALESCE cannot be expressed via TypeORM's @Index decorator — see
    // the entity's docstring, which points back here.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_att_session" ON "attendance_sessions" ("tenant_id", "section_id", "date", COALESCE("period_no", -1))`,
    );

    // 5. attendance_records
    await queryRunner.query(`
      CREATE TABLE "attendance_records" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "session_id" uuid NOT NULL,
        "student_id" uuid NOT NULL,
        "date" date NOT NULL,
        "status" "public"."attendance_status_enum" NOT NULL,
        "minutes_late" int,
        "check_in_at" timestamptz,
        "check_out_at" timestamptz,
        "remarks" varchar(280),
        "source" "public"."attendance_source_enum" NOT NULL DEFAULT 'TEACHER',
        "device_id" uuid,
        "recorded_by_user_id" uuid,
        "recorded_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_attendance_records" PRIMARY KEY ("id"),
        CONSTRAINT "FK_attendance_records_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_attendance_records_session" FOREIGN KEY ("session_id") REFERENCES "attendance_sessions"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_attendance_records_student" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_attendance_records_device" FOREIGN KEY ("device_id") REFERENCES "attendance_devices"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_attendance_records_recorded_by" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_attendance_records_session_student" ON "attendance_records" ("session_id", "student_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_attendance_records_tenant_date_status" ON "attendance_records" ("tenant_id", "date", "status")`,
    );

    // 6. attendance_device_events
    await queryRunner.query(`
      CREATE TABLE "attendance_device_events" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "device_id" uuid NOT NULL,
        "device_event_id" varchar(100) NOT NULL,
        "student_id" uuid,
        "external_ref" varchar(100),
        "occurred_at" timestamptz NOT NULL,
        "direction" "public"."attendance_event_direction_enum" NOT NULL,
        "outcome" varchar(32) NOT NULL,
        "record_id" uuid,
        "raw" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_attendance_device_events" PRIMARY KEY ("id"),
        CONSTRAINT "FK_attendance_device_events_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_attendance_device_events_device" FOREIGN KEY ("device_id") REFERENCES "attendance_devices"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_attendance_device_events_student" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_attendance_device_events_record" FOREIGN KEY ("record_id") REFERENCES "attendance_records"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_attendance_device_events_device_event" ON "attendance_device_events" ("device_id", "device_event_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_attendance_device_events_tenant_occurred" ON "attendance_device_events" ("tenant_id", "occurred_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_attendance_device_events_tenant_occurred"`);
    await queryRunner.query(`DROP INDEX "IDX_attendance_device_events_device_event"`);
    await queryRunner.query(`DROP TABLE "attendance_device_events"`);

    await queryRunner.query(`DROP INDEX "IDX_attendance_records_tenant_date_status"`);
    await queryRunner.query(`DROP INDEX "IDX_attendance_records_session_student"`);
    await queryRunner.query(`DROP TABLE "attendance_records"`);

    await queryRunner.query(`DROP INDEX "UQ_att_session"`);
    await queryRunner.query(`DROP INDEX "IDX_attendance_sessions_section_date"`);
    await queryRunner.query(`DROP INDEX "IDX_attendance_sessions_tenant_date"`);
    await queryRunner.query(`DROP TABLE "attendance_sessions"`);

    await queryRunner.query(`DROP INDEX "IDX_attendance_devices_tenant_id"`);
    await queryRunner.query(`DROP TABLE "attendance_devices"`);

    await queryRunner.query(`DROP INDEX "IDX_school_holidays_tenant_dates"`);
    await queryRunner.query(`DROP TABLE "school_holidays"`);

    await queryRunner.query(`DROP TYPE "public"."attendance_event_direction_enum"`);
    await queryRunner.query(`DROP TYPE "public"."attendance_device_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."attendance_device_kind_enum"`);
    await queryRunner.query(`DROP TYPE "public"."attendance_session_state_enum"`);
    await queryRunner.query(`DROP TYPE "public"."attendance_source_enum"`);
    await queryRunner.query(`DROP TYPE "public"."attendance_status_enum"`);
  }
}
