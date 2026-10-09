import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Pre-PR hardening (Epic 25.0): `updateAllocation()`'s check-then-write
 * (count occupancy, check the target seat is free, then save) has a race
 * under concurrent requests — two requests can both pass the check and both
 * write, double-booking the same seat. A DB constraint is the only thing
 * that actually prevents that, so this adds a unique index on
 * (seat_plan_id, room_id, seat_number, exam_schedule_id) — a seat number is
 * only unique within one room for one subject-sitting, not plan-wide (the
 * same seat number is legitimately reused across rooms and across sittings
 * in the same room, per `allocateSeats`/`reshuffleRoom`).
 *
 * `seat_allocations` has no soft-delete column (see `1789800014000-SeatPlans`
 * — unlike `seat_plans`/`seat_plan_schedules`, it was never given
 * `deleted_at`), so there is nothing to add a `WHERE deleted_at IS NULL`
 * guard against; this is a plain partial-free unique index.
 */
export class SeatAllocationsUniqueSeat1789800015000 implements MigrationInterface {
  name = 'SeatAllocationsUniqueSeat1789800015000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_seat_allocations_room_seat" ON "seat_allocations" ("seat_plan_id", "room_id", "exam_schedule_id", "seat_number")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_seat_allocations_room_seat"`);
  }
}
