import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [52.1.2] D20 — every PENDING `leave_records` row becomes a PENDING
 * `STAFF_LEAVE` application (plus one SUBMITTED event), then the leave row is
 * deleted. APPROVED / REJECTED rows stay: `leave_records` remains the
 * approved-leave ledger.
 *
 * Idempotent: it consumes the PENDING rows it moves, so a second `up()` finds
 * nothing. `down()` re-creates the leave rows (same ids) from the SUBMITTED
 * event's `migrated_from_leave_record_id` marker, for applications still PENDING.
 *
 * Serial (D29): per (tenant, year) continuing after the current max, ordered by
 * created_at. Year is taken in the school's timezone (default Asia/Dhaka, also used when the
 * stored name is empty or not a Postgres timezone).
 */
export class MovePendingLeaveToApplications1791600000100 implements MigrationInterface {
  name = 'MovePendingLeaveToApplications1791600000100';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // One statement so the new application ids line up with the leave ids they
    // came from; the SUBMITTED event and the DELETE read the same CTE rows.
    await queryRunner.query(`
      WITH "pending" AS (
        SELECT "lr"."id" AS "leave_id", "lr"."tenant_id", "lr"."staff_profile_id", "lr"."leave_type",
               "lr"."start_date", "lr"."end_date", "lr"."days", "lr"."created_at",
               coalesce("lr"."reason", '') AS "reason",
               "sp"."user_id" AS "applicant_user_id",
               CASE WHEN lower(coalesce("s"."settings"->'region'->>'locale', 'bn')) LIKE 'en%' THEN 'en' ELSE 'bn' END AS "locale",
               -- A stored timezone is only a string (no IANA check on write), and an unknown name aborts
               -- the whole migration: use it only when Postgres knows it, else the default.
               extract(year FROM "lr"."created_at" AT TIME ZONE coalesce(
                 (SELECT "tz"."name" FROM pg_timezone_names "tz"
                  WHERE "tz"."name" = nullif(trim("s"."settings"->'region'->>'timezone'), '') LIMIT 1),
                 'Asia/Dhaka'
               ))::int AS "serial_year"
        FROM "leave_records" "lr"
        JOIN "staff_profiles" "sp" ON "sp"."id" = "lr"."staff_profile_id" AND "sp"."tenant_id" = "lr"."tenant_id"
        JOIN "schools" "s" ON "s"."id" = "lr"."tenant_id"
        WHERE "lr"."status" = 'PENDING'
      ),
      "numbered" AS (
        SELECT "p".*,
               coalesce((SELECT max("a"."serial_no") FROM "applications" "a"
                         WHERE "a"."tenant_id" = "p"."tenant_id" AND "a"."serial_year" = "p"."serial_year"), 0)
               + row_number() OVER (PARTITION BY "p"."tenant_id", "p"."serial_year" ORDER BY "p"."created_at", "p"."leave_id") AS "serial_no"
        FROM "pending" "p"
      ),
      "inserted" AS (
        INSERT INTO "applications" (
          "id", "tenant_id", "type", "status", "source", "serial_year", "serial_no", "academic_year_id",
          "applicant_user_id", "subject_staff_profile_id", "payload", "start_date", "end_date",
          "letter_text", "letter_locale", "created_at", "updated_at"
        )
        SELECT gen_random_uuid(), "n"."tenant_id", 'STAFF_LEAVE', 'PENDING', 'APP', "n"."serial_year", "n"."serial_no",
               (SELECT "ay"."id" FROM "academic_years" "ay"
                WHERE "ay"."tenant_id" = "n"."tenant_id" AND "ay"."deleted_at" IS NULL
                  AND "n"."start_date" BETWEEN "ay"."start_date" AND "ay"."end_date"
                ORDER BY "ay"."start_date" DESC LIMIT 1),
               "n"."applicant_user_id", "n"."staff_profile_id",
               jsonb_build_object('leave_type', "n"."leave_type", 'start_date', "n"."start_date", 'end_date', "n"."end_date", 'reason', "n"."reason"),
               "n"."start_date", "n"."end_date",
               -- to_char, not date::text: the cast follows the session DateStyle. Latin digits even
               -- in Bangla: a frozen snapshot of migrated rows, not a rendered letter.
               CASE WHEN "n"."locale" = 'en'
                 THEN 'Leave request: ' || to_char("n"."start_date", 'YYYY-MM-DD') || ' to ' || to_char("n"."end_date", 'YYYY-MM-DD') || '. Reason: ' || "n"."reason"
                 ELSE 'ছুটির আবেদন: ' || to_char("n"."start_date", 'YYYY-MM-DD') || ' থেকে ' || to_char("n"."end_date", 'YYYY-MM-DD') || '। কারণ: ' || "n"."reason"
               END,
               "n"."locale", "n"."created_at", "n"."created_at"
        FROM "numbered" "n"
        RETURNING "id", "tenant_id", "subject_staff_profile_id", "serial_year", "serial_no"
      ),
      "events" AS (
        INSERT INTO "application_events" ("tenant_id", "application_id", "actor_user_id", "kind", "step", "data", "created_at")
        SELECT "i"."tenant_id", "i"."id", "n"."applicant_user_id", 'SUBMITTED', 0,
               jsonb_build_object('migrated_from_leave_record_id', "n"."leave_id"::text, 'days', "n"."days"),
               "n"."created_at"
        FROM "inserted" "i"
        JOIN "numbered" "n" ON "n"."tenant_id" = "i"."tenant_id" AND "n"."serial_year" = "i"."serial_year" AND "n"."serial_no" = "i"."serial_no"
        RETURNING 1
      )
      DELETE FROM "leave_records" WHERE "id" IN (SELECT "leave_id" FROM "pending")
    `);
    // A PENDING row the CTE could not move (its staff profile is in another school) would be
    // stranded once the old leave routes are gone. Fail loudly; the migration rolls back.
    const [{ n }] = await queryRunner.query(
      `SELECT count(*)::int AS "n" FROM "leave_records" WHERE "status" = 'PENDING'`,
    );
    if (n > 0) {
      throw new Error(
        `${n} PENDING leave_records row(s) could not be moved to applications: their staff profile belongs to another school.`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      WITH "moved" AS (
        SELECT "a"."id" AS "application_id", "a"."tenant_id", "a"."subject_staff_profile_id",
               "a"."payload", "a"."created_at", "e"."data"
        FROM "applications" "a"
        JOIN "application_events" "e" ON "e"."application_id" = "a"."id" AND "e"."kind" = 'SUBMITTED'
        WHERE "a"."type" = 'STAFF_LEAVE' AND "a"."status" = 'PENDING' AND "e"."data" ? 'migrated_from_leave_record_id'
      ),
      "restored" AS (
        INSERT INTO "leave_records" ("id", "tenant_id", "staff_profile_id", "leave_type", "start_date", "end_date", "days", "status", "reason", "created_at")
        SELECT ("m"."data"->>'migrated_from_leave_record_id')::uuid, "m"."tenant_id", "m"."subject_staff_profile_id",
               ("m"."payload"->>'leave_type')::"public"."leave_type_enum",
               ("m"."payload"->>'start_date')::date, ("m"."payload"->>'end_date')::date,
               ("m"."data"->>'days')::int, 'PENDING', nullif("m"."payload"->>'reason', ''), "m"."created_at"
        FROM "moved" "m"
        RETURNING 1
      )
      DELETE FROM "applications" WHERE "id" IN (SELECT "application_id" FROM "moved")
    `);
  }
}
