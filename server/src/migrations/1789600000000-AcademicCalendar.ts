import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [17.1.2]/#703 — renames `school_holidays` to `calendar_events` and widens
 * it into the general calendar entry (holiday, exam day, school event,
 * meeting, deadline) that the rest of Epic 17 builds on. Adds the term
 * calendar (`academic_terms`), per-class scoping (`calendar_event_classes`),
 * the public-holiday import source-of-truth (`public_holiday_sets` /
 * `public_holiday_entries` — platform tables, no `tenant_id` by design,
 * D10), and the ICS feed-subscription tokens (`calendar_feed_tokens`, D13).
 *
 * `up()` order is FK-forced: `btree_gist` extension first (needed by
 * `academic_terms`' exclusion constraint), then rename+extend
 * `school_holidays` -> `calendar_events` (preserves every existing row,
 * backfills `type = 'HOLIDAY'` and `published_at = created_at`), then
 * `calendar_event_classes` (depends on `calendar_events`/`classes`), then
 * `academic_terms` (depends on `academic_years`), then the two
 * platform-level public-holiday tables, then `calendar_feed_tokens`
 * (depends on `schools`).
 */
export class AcademicCalendar1789600000000 implements MigrationInterface {
  name = 'AcademicCalendar1789600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 0. Extension needed by academic_terms' exclusion constraint below.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS btree_gist`);

    // 1. school_holidays -> calendar_events, widened.
    await queryRunner.query(`ALTER TABLE "school_holidays" RENAME TO "calendar_events"`);
    await queryRunner.query(
      `ALTER TABLE "calendar_events" RENAME CONSTRAINT "PK_school_holidays" TO "PK_calendar_events"`,
    );
    await queryRunner.query(
      `ALTER TABLE "calendar_events" RENAME CONSTRAINT "CHK_school_holidays_date_range" TO "CHK_calendar_events_date_range"`,
    );
    await queryRunner.query(
      `ALTER TABLE "calendar_events" RENAME CONSTRAINT "FK_school_holidays_tenant" TO "FK_calendar_events_tenant"`,
    );
    await queryRunner.query(
      `ALTER TABLE "calendar_events" RENAME CONSTRAINT "FK_school_holidays_academic_year" TO "FK_calendar_events_academic_year"`,
    );
    await queryRunner.query(
      `ALTER INDEX "IDX_school_holidays_tenant_dates" RENAME TO "IDX_calendar_events_tenant_dates"`,
    );

    await queryRunner.query(
      `ALTER TABLE "calendar_events" ADD COLUMN "type" varchar NOT NULL DEFAULT 'HOLIDAY'`,
    );
    await queryRunner.query(`ALTER TABLE "calendar_events" ADD COLUMN "description" text`);
    await queryRunner.query(`ALTER TABLE "calendar_events" ADD COLUMN "start_time" time`);
    await queryRunner.query(`ALTER TABLE "calendar_events" ADD COLUMN "end_time" time`);
    await queryRunner.query(
      `ALTER TABLE "calendar_events" ADD COLUMN "audience" varchar NOT NULL DEFAULT 'ALL'`,
    );
    await queryRunner.query(`ALTER TABLE "calendar_events" ADD COLUMN "published_at" timestamptz`);
    // Every existing row is a published holiday — backfill so the D9
    // "draft never affects working-day math" rule doesn't silently hide
    // pre-existing holidays.
    await queryRunner.query(`UPDATE "calendar_events" SET "published_at" = "created_at"`);
    await queryRunner.query(
      `ALTER TABLE "calendar_events" ADD COLUMN "external_refs" jsonb NOT NULL DEFAULT '{}'`,
    );
    await queryRunner.query(`ALTER TABLE "calendar_events" ADD COLUMN "created_by_user_id" uuid`);
    await queryRunner.query(`ALTER TABLE "calendar_events" ADD COLUMN "updated_by_user_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "calendar_events" ADD CONSTRAINT "CHK_calendar_events_time_range" CHECK ("start_time" IS NULL OR "end_time" IS NULL OR "start_time" <= "end_time")`,
    );
    // Composite unique so calendar_event_classes' FK below can pin
    // (event_id, tenant_id) together — Postgres otherwise happily accepts
    // an event/class/link row from three different tenants, since a plain
    // `FK (event_id) REFERENCES calendar_events(id)` says nothing about
    // tenant_id at all. `id` is already globally unique (PK), so this adds
    // no new constraint on real data, only a target for the composite FK.
    await queryRunner.query(
      `ALTER TABLE "calendar_events" ADD CONSTRAINT "UQ_calendar_events_id_tenant" UNIQUE ("id", "tenant_id")`,
    );

    // 2. calendar_event_classes
    // NOTE: only the event_id leg is composite-FK'd to (event_id, tenant_id)
    // here, since that table (calendar_events) is this migration's own.
    // class_id and academic_year_id have the same theoretical gap against
    // `classes`/`academic_years`, but hardening those means adding a
    // composite unique key to tables this migration doesn't own and many
    // other epics already depend on — left as a follow-up rather than
    // widened here. Application code (`assertClassesInTenant`) already
    // checks tenant_id match on every write.
    await queryRunner.query(`
      CREATE TABLE "calendar_event_classes" (
        "event_id" uuid NOT NULL,
        "class_id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        CONSTRAINT "PK_calendar_event_classes" PRIMARY KEY ("event_id", "class_id"),
        CONSTRAINT "FK_calendar_event_classes_event" FOREIGN KEY ("event_id", "tenant_id") REFERENCES "calendar_events"("id", "tenant_id") ON DELETE CASCADE,
        CONSTRAINT "FK_calendar_event_classes_class" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_calendar_event_classes_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_calendar_event_classes_tenant_class" ON "calendar_event_classes" ("tenant_id", "class_id")`,
    );

    // 3. academic_terms
    await queryRunner.query(`
      CREATE TABLE "academic_terms" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "academic_year_id" uuid NOT NULL,
        "seq" integer NOT NULL,
        "name" varchar(80) NOT NULL,
        "start_date" date NOT NULL,
        "end_date" date NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_academic_terms" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_academic_terms_date_range" CHECK ("start_date" <= "end_date"),
        CONSTRAINT "FK_academic_terms_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_academic_terms_academic_year" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_academic_terms_tenant_academic_year" ON "academic_terms" ("tenant_id", "academic_year_id")`,
    );
    // D5: two non-deleted terms in the same academic year can never overlap.
    await queryRunner.query(`
      ALTER TABLE "academic_terms" ADD CONSTRAINT "EXCL_academic_terms_no_overlap"
        EXCLUDE USING gist (
          "academic_year_id" WITH =,
          daterange("start_date", "end_date", '[]') WITH &&
        ) WHERE ("deleted_at" IS NULL)
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_academic_terms_year_seq" ON "academic_terms" ("academic_year_id", "seq")
        WHERE "deleted_at" IS NULL
    `);

    // 4. public_holiday_sets / public_holiday_entries — platform tables, no
    // tenant_id by design (D10): shared across every tenant in the same
    // country/year.
    await queryRunner.query(`
      CREATE TABLE "public_holiday_sets" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "country" char(2) NOT NULL,
        "year" integer NOT NULL,
        "source" varchar NOT NULL,
        "published_at" timestamptz,
        "fetched_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_public_holiday_sets" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_public_holiday_sets_country_year" UNIQUE ("country", "year")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "public_holiday_entries" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "set_id" uuid NOT NULL,
        "date" date NOT NULL,
        "end_date" date NOT NULL,
        "name" varchar(120) NOT NULL,
        "name_bn" varchar(120),
        CONSTRAINT "PK_public_holiday_entries" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_public_holiday_entries_date_range" CHECK ("date" <= "end_date"),
        CONSTRAINT "FK_public_holiday_entries_set" FOREIGN KEY ("set_id") REFERENCES "public_holiday_sets"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_public_holiday_entries_set" ON "public_holiday_entries" ("set_id")`,
    );

    // 5. calendar_feed_tokens (D13): one active token per (tenant_id, user_id).
    await queryRunner.query(`
      CREATE TABLE "calendar_feed_tokens" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "token_hash" char(64) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "revoked_at" timestamptz,
        CONSTRAINT "PK_calendar_feed_tokens" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_calendar_feed_tokens_token_hash" UNIQUE ("token_hash"),
        CONSTRAINT "FK_calendar_feed_tokens_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_calendar_feed_tokens_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_calendar_feed_tokens_active_per_user" ON "calendar_feed_tokens" ("tenant_id", "user_id")
        WHERE "revoked_at" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_calendar_feed_tokens_user" ON "calendar_feed_tokens" ("user_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "calendar_feed_tokens"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "public_holiday_entries"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "public_holiday_sets"`);
    // CASCADE: [19.2.1]'s `exams.academic_term_id` FK now references this
    // table, and later migrations may add more — down() is a full rollback,
    // so cascading its dependents is correct here, unlike a normal DROP.
    await queryRunner.query(`DROP TABLE IF EXISTS "academic_terms" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "calendar_event_classes"`);

    await queryRunner.query(
      `ALTER TABLE "calendar_events" DROP CONSTRAINT IF EXISTS "UQ_calendar_events_id_tenant"`,
    );
    await queryRunner.query(
      `ALTER TABLE "calendar_events" DROP CONSTRAINT IF EXISTS "CHK_calendar_events_time_range"`,
    );
    await queryRunner.query(
      `ALTER TABLE "calendar_events" DROP COLUMN IF EXISTS "updated_by_user_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "calendar_events" DROP COLUMN IF EXISTS "created_by_user_id"`,
    );
    await queryRunner.query(`ALTER TABLE "calendar_events" DROP COLUMN IF EXISTS "external_refs"`);
    await queryRunner.query(`ALTER TABLE "calendar_events" DROP COLUMN IF EXISTS "published_at"`);
    await queryRunner.query(`ALTER TABLE "calendar_events" DROP COLUMN IF EXISTS "audience"`);
    await queryRunner.query(`ALTER TABLE "calendar_events" DROP COLUMN IF EXISTS "end_time"`);
    await queryRunner.query(`ALTER TABLE "calendar_events" DROP COLUMN IF EXISTS "start_time"`);
    await queryRunner.query(`ALTER TABLE "calendar_events" DROP COLUMN IF EXISTS "description"`);
    await queryRunner.query(`ALTER TABLE "calendar_events" DROP COLUMN IF EXISTS "type"`);

    await queryRunner.query(
      `ALTER INDEX "IDX_calendar_events_tenant_dates" RENAME TO "IDX_school_holidays_tenant_dates"`,
    );
    await queryRunner.query(
      `ALTER TABLE "calendar_events" RENAME CONSTRAINT "FK_calendar_events_academic_year" TO "FK_school_holidays_academic_year"`,
    );
    await queryRunner.query(
      `ALTER TABLE "calendar_events" RENAME CONSTRAINT "FK_calendar_events_tenant" TO "FK_school_holidays_tenant"`,
    );
    await queryRunner.query(
      `ALTER TABLE "calendar_events" RENAME CONSTRAINT "CHK_calendar_events_date_range" TO "CHK_school_holidays_date_range"`,
    );
    await queryRunner.query(
      `ALTER TABLE "calendar_events" RENAME CONSTRAINT "PK_calendar_events" TO "PK_school_holidays"`,
    );
    await queryRunner.query(`ALTER TABLE "calendar_events" RENAME TO "school_holidays"`);
  }
}
