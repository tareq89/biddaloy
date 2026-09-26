import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [25.1.1] `seat_plans` (a named grouping of exam schedules whose students
 * get seats generated together), `seat_plan_schedules` (which exam
 * schedules belong to a plan — D6's "one plan per schedule" constraint) and
 * `seat_allocations` (one student's seat for one subject sitting).
 *
 * Also adds `exam_schedules.room_id`, the additive FK the entity's
 * docstring always planned for once a `rooms` table existed (it now does,
 * via `1789800011000-AddRoutines`). `venue` stays as free text; `up()`
 * best-effort backfills `room_id` by matching `venue` case-insensitively to
 * `rooms.room_no` within the same tenant. Rows with no confident match keep
 * `room_id` NULL — this must never fail the migration.
 */
export class SeatPlans1789800014000 implements MigrationInterface {
  name = 'SeatPlans1789800014000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- exam_schedules.room_id -----------------------------------------
    await queryRunner.query(`ALTER TABLE "exam_schedules" ADD "room_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "exam_schedules" ADD CONSTRAINT "FK_exam_schedules_room" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    // Best-effort backfill: match venue text to a room_no in the same
    // tenant, case-insensitively. Ambiguous (no match, venue null, or more
    // than one room sharing a normalized room_no) rows are simply left
    // NULL — never fails the migration, and never picks an arbitrary room
    // out of multiple matches.
    await queryRunner.query(`
      UPDATE "exam_schedules" es
      SET "room_id" = matched."room_id"
      FROM (
        SELECT r."tenant_id", lower(trim(r."room_no")) AS normalized_room_no,
               (array_agg(r."id"))[1] AS "room_id"
        FROM "rooms" r
        WHERE r."deleted_at" IS NULL
        GROUP BY r."tenant_id", lower(trim(r."room_no"))
        HAVING count(*) = 1
      ) matched
      WHERE matched."tenant_id" = es."tenant_id"
        AND es."venue" IS NOT NULL
        AND matched."normalized_room_no" = lower(trim(es."venue"))
    `);

    // --- seat_plans -------------------------------------------------------
    await queryRunner.query(
      `CREATE TYPE "public"."seat_plans_status_enum" AS ENUM('DRAFT', 'PUBLISHED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."seat_plans_seat_order_mode_enum" AS ENUM('SEQUENTIAL', 'RANDOM')`,
    );
    await queryRunner.query(`
      CREATE TABLE "seat_plans" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "name" varchar(200) NOT NULL,
        "status" "public"."seat_plans_status_enum" NOT NULL DEFAULT 'DRAFT',
        "seat_order_mode" "public"."seat_plans_seat_order_mode_enum" NOT NULL,
        "published_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_seat_plans" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_seat_plans_tenant" ON "seat_plans" ("tenant_id")`);
    await queryRunner.query(
      `ALTER TABLE "seat_plans" ADD CONSTRAINT "FK_seat_plans_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // --- seat_plan_schedules -----------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "seat_plan_schedules" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "seat_plan_id" uuid NOT NULL,
        "exam_schedule_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_seat_plan_schedules" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_seat_plan_schedules_tenant_plan" ON "seat_plan_schedules" ("tenant_id", "seat_plan_id")`,
    );
    // D6: an exam schedule can only sit in one (non-deleted) plan.
    // Cannot see the plan's own status here (a plain index can't join), so
    // the "no PUBLISHED plan already has it" half of D6 is enforced in the
    // service layer (#25.4).
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_seat_plan_schedules_tenant_exam_schedule" ON "seat_plan_schedules" ("tenant_id", "exam_schedule_id") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "seat_plan_schedules" ADD CONSTRAINT "FK_seat_plan_schedules_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "seat_plan_schedules" ADD CONSTRAINT "FK_seat_plan_schedules_seat_plan" FOREIGN KEY ("seat_plan_id") REFERENCES "seat_plans"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "seat_plan_schedules" ADD CONSTRAINT "FK_seat_plan_schedules_exam_schedule" FOREIGN KEY ("exam_schedule_id") REFERENCES "exam_schedules"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // --- seat_allocations ---------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "seat_allocations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "seat_plan_id" uuid NOT NULL,
        "exam_schedule_id" uuid NOT NULL,
        "student_id" uuid NOT NULL,
        "room_id" uuid NOT NULL,
        "seat_number" varchar(20) NOT NULL,
        "invigilator_user_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_seat_allocations" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_seat_allocations_tenant_plan_schedule" ON "seat_allocations" ("tenant_id", "seat_plan_id", "exam_schedule_id")`,
    );
    // One seat per student per subject-sitting per plan.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_seat_allocations_plan_schedule_student" ON "seat_allocations" ("tenant_id", "seat_plan_id", "exam_schedule_id", "student_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "seat_allocations" ADD CONSTRAINT "FK_seat_allocations_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "seat_allocations" ADD CONSTRAINT "FK_seat_allocations_seat_plan" FOREIGN KEY ("seat_plan_id") REFERENCES "seat_plans"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "seat_allocations" ADD CONSTRAINT "FK_seat_allocations_exam_schedule" FOREIGN KEY ("exam_schedule_id") REFERENCES "exam_schedules"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "seat_allocations" ADD CONSTRAINT "FK_seat_allocations_student" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "seat_allocations" ADD CONSTRAINT "FK_seat_allocations_room" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "seat_allocations" ADD CONSTRAINT "FK_seat_allocations_invigilator" FOREIGN KEY ("invigilator_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "seat_allocations" DROP CONSTRAINT "FK_seat_allocations_invigilator"`,
    );
    await queryRunner.query(
      `ALTER TABLE "seat_allocations" DROP CONSTRAINT "FK_seat_allocations_room"`,
    );
    await queryRunner.query(
      `ALTER TABLE "seat_allocations" DROP CONSTRAINT "FK_seat_allocations_student"`,
    );
    await queryRunner.query(
      `ALTER TABLE "seat_allocations" DROP CONSTRAINT "FK_seat_allocations_exam_schedule"`,
    );
    await queryRunner.query(
      `ALTER TABLE "seat_allocations" DROP CONSTRAINT "FK_seat_allocations_seat_plan"`,
    );
    await queryRunner.query(
      `ALTER TABLE "seat_allocations" DROP CONSTRAINT "FK_seat_allocations_tenant"`,
    );
    await queryRunner.query(`DROP TABLE "seat_allocations"`);

    await queryRunner.query(
      `ALTER TABLE "seat_plan_schedules" DROP CONSTRAINT "FK_seat_plan_schedules_exam_schedule"`,
    );
    await queryRunner.query(
      `ALTER TABLE "seat_plan_schedules" DROP CONSTRAINT "FK_seat_plan_schedules_seat_plan"`,
    );
    await queryRunner.query(
      `ALTER TABLE "seat_plan_schedules" DROP CONSTRAINT "FK_seat_plan_schedules_tenant"`,
    );
    await queryRunner.query(`DROP TABLE "seat_plan_schedules"`);

    await queryRunner.query(`ALTER TABLE "seat_plans" DROP CONSTRAINT "FK_seat_plans_tenant"`);
    await queryRunner.query(`DROP TABLE "seat_plans"`);
    await queryRunner.query(`DROP TYPE "public"."seat_plans_seat_order_mode_enum"`);
    await queryRunner.query(`DROP TYPE "public"."seat_plans_status_enum"`);

    await queryRunner.query(
      `ALTER TABLE "exam_schedules" DROP CONSTRAINT "FK_exam_schedules_room"`,
    );
    await queryRunner.query(`ALTER TABLE "exam_schedules" DROP COLUMN "room_id"`);
  }
}
