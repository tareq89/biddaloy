import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [21.2.1] Adds the class-routine/timetable domain: `shifts`,
 * `period_slots`, `rooms`, `routines`, `routine_slots`,
 * `routine_slot_teachers`, `routine_substitutions`,
 * `routine_change_requests` — plus promotes `classes.shift` (free text,
 * [33.2.1]) to a real `classes.shift_id` FK into the new `shifts` table.
 *
 * `up()` order is FK-forced: enum types first, then `shifts` (only
 * depends on `schools`), then the `classes.shift_id` promotion (depends
 * on `shifts` existing and `classes.shift` already being populated), then
 * `period_slots` (depends on `shifts`), `rooms` (depends on `schools`),
 * `routines` (depends on `schools`/`academic_years`), `routine_slots`
 * (depends on `routines`/`class_sections`/`period_slots`/`subjects`/
 * `rooms`), and finally `routine_slot_teachers`/`routine_substitutions`/
 * `routine_change_requests` (all depend on `routine_slots`).
 *
 * Shift promotion (Epic 33.0 D10's exact prescription): one `shifts` row
 * per distinct `(tenant_id, shift)` pair already on `classes`, then
 * `classes.shift_id` is backfilled by matching name. `classes.shift`
 * itself is **not** dropped here — kept for one release as a rollback
 * path; a follow-up ticket drops it once `shift_id` has proven itself.
 *
 * A promoted `shifts` row has no real `day_starts_at`/`day_ends_at`/
 * `sequence` to draw from (`classes.shift` was only ever a name) — those
 * columns are `NOT NULL` per [21.2.1]'s plan, so the backfill `INSERT`
 * gives every promoted row the placeholder `08:00:00`–`13:00:00` window
 * and `sequence = 0`. This is a deliberate simplification, not a derived
 * fact: a school's real shift hours still need setting once a shift
 * settings UI exists (tracked in Epic 21.0, not this ticket).
 *
 * Two constraints can't be expressed with TypeORM's `@Index`/`@Column`
 * decorators and are raw SQL / table constraints here: `rooms`' unique
 * index uses `NULLS NOT DISTINCT` (nullable `building`), same problem
 * `AddOrganisationDimensions` solved for `classes.shift`/`version`; and
 * `period_slots`'/`routine_slots`' `CHECK` constraints are table
 * constraints, not indexes.
 */
export class AddRoutines1789800011000 implements MigrationInterface {
  name = 'AddRoutines1789800011000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Enum types
    await queryRunner.query(
      `CREATE TYPE "public"."period_slot_kind_enum" AS ENUM('CLASS', 'BREAK')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."routine_state_enum" AS ENUM('DRAFT', 'REVIEW', 'PUBLISHED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."slot_recurrence_enum" AS ENUM('WEEKLY', 'BIWEEKLY', 'MONTHLY')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."change_request_state_enum" AS ENUM('OPEN', 'ACCEPTED', 'REJECTED')`,
    );

    // 2. shifts
    await queryRunner.query(`
      CREATE TABLE "shifts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "name" varchar(100) NOT NULL,
        "day_starts_at" time NOT NULL,
        "day_ends_at" time NOT NULL,
        "sequence" smallint NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_shifts" PRIMARY KEY ("id"),
        CONSTRAINT "FK_shifts_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_shifts_time_range" CHECK ("day_starts_at" < "day_ends_at")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_shifts_tenant_name" ON "shifts" ("tenant_id", "name") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_shifts_tenant_id" ON "shifts" ("tenant_id")`);

    // 3. classes.shift -> shifts.id promotion (Epic 33.0 D10)
    await queryRunner.query(`
      INSERT INTO "shifts" ("tenant_id", "name", "day_starts_at", "day_ends_at", "sequence")
      SELECT DISTINCT "tenant_id", "shift", '08:00:00'::time, '13:00:00'::time, 0::smallint
      FROM "classes"
      WHERE "shift" IS NOT NULL
    `);
    await queryRunner.query(`ALTER TABLE "classes" ADD "shift_id" uuid`);
    await queryRunner.query(`
      UPDATE "classes" c
      SET "shift_id" = s."id"
      FROM "shifts" s
      WHERE c."tenant_id" = s."tenant_id" AND c."shift" = s."name"
    `);
    await queryRunner.query(`
      ALTER TABLE "classes"
      ADD CONSTRAINT "FK_classes_shift" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`CREATE INDEX "IDX_classes_shift_id" ON "classes" ("shift_id")`);

    // 4. period_slots
    await queryRunner.query(`
      CREATE TABLE "period_slots" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "shift_id" uuid NOT NULL,
        "sequence" smallint NOT NULL,
        "kind" "public"."period_slot_kind_enum" NOT NULL,
        "name" varchar(50),
        "starts_at" time NOT NULL,
        "ends_at" time NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_period_slots" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_period_slots_time_range" CHECK ("starts_at" < "ends_at"),
        CONSTRAINT "FK_period_slots_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_period_slots_shift" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_period_slots_shift_sequence" ON "period_slots" ("shift_id", "sequence")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_period_slots_tenant_id" ON "period_slots" ("tenant_id")`,
    );

    // 5. rooms
    await queryRunner.query(`
      CREATE TABLE "rooms" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "building" varchar(100),
        "room_no" varchar(50) NOT NULL,
        "capacity" int,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_rooms" PRIMARY KEY ("id"),
        CONSTRAINT "FK_rooms_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE
      )
    `);
    // NULLS NOT DISTINCT: a room with no `building` set must still collide
    // with another same-numbered room with no `building` set — see the
    // entity's docstring and `AddOrganisationDimensions` for the same
    // problem on `classes.shift`/`version`.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_rooms_tenant_building_room_no" ON "rooms" ("tenant_id", "building", "room_no")
      NULLS NOT DISTINCT WHERE "deleted_at" IS NULL
    `);
    await queryRunner.query(`CREATE INDEX "IDX_rooms_tenant_id" ON "rooms" ("tenant_id")`);

    // 6. routines
    await queryRunner.query(`
      CREATE TABLE "routines" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "academic_year_id" uuid NOT NULL,
        "name" varchar(100) NOT NULL,
        "state" "public"."routine_state_enum" NOT NULL DEFAULT 'DRAFT',
        "published_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_routines" PRIMARY KEY ("id"),
        CONSTRAINT "FK_routines_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_routines_academic_year" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_routines_tenant_academic_year" ON "routines" ("tenant_id", "academic_year_id")
      WHERE "deleted_at" IS NULL
    `);
    await queryRunner.query(`CREATE INDEX "IDX_routines_tenant_id" ON "routines" ("tenant_id")`);

    // 7. routine_slots
    await queryRunner.query(`
      CREATE TABLE "routine_slots" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "routine_id" uuid NOT NULL,
        "section_id" uuid NOT NULL,
        "period_slot_id" uuid NOT NULL,
        "weekday" smallint NOT NULL,
        "subject_id" uuid NOT NULL,
        "room_id" uuid,
        "recurrence" "public"."slot_recurrence_enum" NOT NULL,
        "recurrence_offset" smallint NOT NULL DEFAULT 0,
        "valid_from" date NOT NULL,
        "valid_to" date,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_routine_slots" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_routine_slots_weekday" CHECK ("weekday" BETWEEN 0 AND 6),
        CONSTRAINT "CHK_routine_slots_valid_range" CHECK ("valid_to" IS NULL OR "valid_from" <= "valid_to"),
        CONSTRAINT "FK_routine_slots_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_routine_slots_routine" FOREIGN KEY ("routine_id") REFERENCES "routines"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_routine_slots_section" FOREIGN KEY ("section_id") REFERENCES "class_sections"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_routine_slots_period_slot" FOREIGN KEY ("period_slot_id") REFERENCES "period_slots"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_routine_slots_subject" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_routine_slots_room" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE SET NULL
      )
    `);
    // No unique index on (section_id, period_slot_id, weekday) — see the
    // entity's docstring (D4): effective dating means two rows legitimately
    // coexist with disjoint date ranges; overlap is enforced in the service.
    await queryRunner.query(
      `CREATE INDEX "IDX_routine_slots_tenant_section_weekday" ON "routine_slots" ("tenant_id", "section_id", "weekday")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_routine_slots_tenant_routine" ON "routine_slots" ("tenant_id", "routine_id")`,
    );

    // 8. routine_slot_teachers
    await queryRunner.query(`
      CREATE TABLE "routine_slot_teachers" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "routine_slot_id" uuid NOT NULL,
        "teacher_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_routine_slot_teachers" PRIMARY KEY ("id"),
        CONSTRAINT "FK_routine_slot_teachers_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_routine_slot_teachers_slot" FOREIGN KEY ("routine_slot_id") REFERENCES "routine_slots"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_routine_slot_teachers_teacher" FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_routine_slot_teachers_slot_teacher" ON "routine_slot_teachers" ("routine_slot_id", "teacher_id")`,
    );
    // D15: what a "show me this teacher's week" read uses.
    await queryRunner.query(
      `CREATE INDEX "IDX_routine_slot_teachers_tenant_teacher" ON "routine_slot_teachers" ("tenant_id", "teacher_id")`,
    );

    // 9. routine_substitutions
    await queryRunner.query(`
      CREATE TABLE "routine_substitutions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "routine_slot_id" uuid NOT NULL,
        "date" date NOT NULL,
        "substitute_teacher_id" uuid,
        "is_cancelled" boolean NOT NULL DEFAULT false,
        "reason" varchar(280),
        "created_by" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_routine_substitutions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_routine_substitutions_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_routine_substitutions_slot" FOREIGN KEY ("routine_slot_id") REFERENCES "routine_slots"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_routine_substitutions_substitute_teacher" FOREIGN KEY ("substitute_teacher_id") REFERENCES "teachers"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_routine_substitutions_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_routine_substitutions_slot_date" ON "routine_substitutions" ("routine_slot_id", "date")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_routine_substitutions_tenant_id" ON "routine_substitutions" ("tenant_id")`,
    );

    // 10. routine_change_requests
    await queryRunner.query(`
      CREATE TABLE "routine_change_requests" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "routine_slot_id" uuid NOT NULL,
        "requested_by" uuid NOT NULL,
        "note" varchar(500) NOT NULL,
        "state" "public"."change_request_state_enum" NOT NULL DEFAULT 'OPEN',
        "resolved_by" uuid,
        "resolved_at" timestamptz,
        "resolution_note" varchar(500),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_routine_change_requests" PRIMARY KEY ("id"),
        CONSTRAINT "FK_routine_change_requests_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_routine_change_requests_slot" FOREIGN KEY ("routine_slot_id") REFERENCES "routine_slots"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_routine_change_requests_requested_by" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_routine_change_requests_resolved_by" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_routine_change_requests_tenant_id" ON "routine_change_requests" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_routine_change_requests_tenant_slot" ON "routine_change_requests" ("tenant_id", "routine_slot_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_routine_change_requests_tenant_slot"`);
    await queryRunner.query(`DROP INDEX "IDX_routine_change_requests_tenant_id"`);
    await queryRunner.query(`DROP TABLE "routine_change_requests"`);

    await queryRunner.query(`DROP INDEX "IDX_routine_substitutions_tenant_id"`);
    await queryRunner.query(`DROP INDEX "UQ_routine_substitutions_slot_date"`);
    await queryRunner.query(`DROP TABLE "routine_substitutions"`);

    await queryRunner.query(`DROP INDEX "IDX_routine_slot_teachers_tenant_teacher"`);
    await queryRunner.query(`DROP INDEX "UQ_routine_slot_teachers_slot_teacher"`);
    await queryRunner.query(`DROP TABLE "routine_slot_teachers"`);

    await queryRunner.query(`DROP INDEX "IDX_routine_slots_tenant_routine"`);
    await queryRunner.query(`DROP INDEX "IDX_routine_slots_tenant_section_weekday"`);
    await queryRunner.query(`DROP TABLE "routine_slots"`);

    await queryRunner.query(`DROP INDEX "IDX_routines_tenant_id"`);
    await queryRunner.query(`DROP INDEX "UQ_routines_tenant_academic_year"`);
    await queryRunner.query(`DROP TABLE "routines"`);

    await queryRunner.query(`DROP INDEX "IDX_rooms_tenant_id"`);
    await queryRunner.query(`DROP INDEX "UQ_rooms_tenant_building_room_no"`);
    await queryRunner.query(`DROP TABLE "rooms"`);

    await queryRunner.query(`DROP INDEX "IDX_period_slots_tenant_id"`);
    await queryRunner.query(`DROP INDEX "UQ_period_slots_shift_sequence"`);
    await queryRunner.query(`DROP TABLE "period_slots"`);

    // classes.shift_id promotion: `shift` (the string column) was never
    // touched, so nothing here loses data — it drops the derived column
    // and restores `classes` to its pre-migration shape.
    await queryRunner.query(`DROP INDEX "IDX_classes_shift_id"`);
    await queryRunner.query(`ALTER TABLE "classes" DROP CONSTRAINT "FK_classes_shift"`);
    await queryRunner.query(`ALTER TABLE "classes" DROP COLUMN "shift_id"`);

    await queryRunner.query(`DROP INDEX "IDX_shifts_tenant_id"`);
    await queryRunner.query(`DROP INDEX "UQ_shifts_tenant_name"`);
    await queryRunner.query(`DROP TABLE "shifts"`);

    await queryRunner.query(`DROP TYPE "public"."change_request_state_enum"`);
    await queryRunner.query(`DROP TYPE "public"."slot_recurrence_enum"`);
    await queryRunner.query(`DROP TYPE "public"."routine_state_enum"`);
    await queryRunner.query(`DROP TYPE "public"."period_slot_kind_enum"`);
  }
}
