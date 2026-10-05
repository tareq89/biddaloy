import { ConflictException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { EnrollmentStatus } from '@biddaloy/shared';

export interface SeatUsage {
  used: number;
  /** `null` = unlimited. */
  limit: number | null;
}

/** A seat is a student with enrollment_status ACTIVE who is not soft-deleted (D29). */
async function countSeats(manager: EntityManager, tenantId: string): Promise<number> {
  const rows: { n: string }[] = await manager.query(
    `SELECT count(*)::text AS n FROM students
      WHERE tenant_id = $1 AND deleted_at IS NULL AND enrollment_status = $2`,
    [tenantId, EnrollmentStatus.ACTIVE],
  );
  return Number(rows[0].n);
}

/**
 * Locks the School row and reads usage; an unlimited school (`limit: null`) takes no lock. Must
 * run inside the caller's transaction: the lock lasts until commit, so concurrent adds queue
 * behind it. `FOR NO KEY UPDATE`, not `FOR UPDATE`: every insert into a table with an FK to
 * `schools` takes `FOR KEY SHARE` on the school row, and `FOR UPDATE` conflicts with that and
 * deadlocks (40P01).
 */
export async function lockSeatUsage(manager: EntityManager, tenantId: string): Promise<SeatUsage> {
  // Unlocked peek first: an unlimited school (the common case) never pays for the lock.
  const [peek]: { seat_limit: number | null }[] = await manager.query(
    'SELECT seat_limit FROM schools WHERE id = $1',
    [tenantId],
  );
  if (!peek || peek.seat_limit === null) return { used: 0, limit: null };

  // Re-read from the locked row so a limit changed in between is honoured.
  const [locked]: { seat_limit: number | null }[] = await manager.query(
    'SELECT seat_limit FROM schools WHERE id = $1 FOR NO KEY UPDATE',
    [tenantId],
  );
  if (!locked || locked.seat_limit === null) return { used: 0, limit: null };
  return { used: await countSeats(manager, tenantId), limit: locked.seat_limit };
}

export function seatLimitError(used: number, limit: number, requested: number): ConflictException {
  return new ConflictException({
    message: `Seat limit reached: ${used} of ${limit} seats in use`,
    details: { code: 'SEAT_LIMIT_REACHED', used, limit, requested },
  });
}

/** 409 SEAT_LIMIT_REACHED when adding `count` ACTIVE students would pass `seat_limit`. */
export async function assertSeatsAvailable(
  manager: EntityManager,
  tenantId: string,
  count: number,
): Promise<void> {
  if (count <= 0) return;
  const { used, limit } = await lockSeatUsage(manager, tenantId);
  if (limit !== null && used + count > limit) throw seatLimitError(used, limit, count);
}

/** Read-only usage for previews; takes no lock. */
export async function getSeatUsage(manager: EntityManager, tenantId: string): Promise<SeatUsage> {
  const [school]: { seat_limit: number | null }[] = await manager.query(
    'SELECT seat_limit FROM schools WHERE id = $1',
    [tenantId],
  );
  return { used: await countSeats(manager, tenantId), limit: school?.seat_limit ?? null };
}
