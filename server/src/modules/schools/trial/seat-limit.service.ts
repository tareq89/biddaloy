import { ConflictException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
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
 * Throws 409 SEAT_LIMIT_REACHED when adding `count` more ACTIVE students would pass the school's
 * `seat_limit`. Must run inside the caller's transaction: it locks the School row
 * (`SELECT … FOR UPDATE`) until commit, so two concurrent adds cannot both pass the check.
 * `seat_limit = NULL` is unlimited and takes no lock.
 */
export async function assertSeatsAvailable(
  manager: EntityManager,
  tenantId: string,
  count: number,
): Promise<void> {
  if (count <= 0) return;
  // Unlocked peek first: an unlimited school (the common case) never pays for the lock. The limit
  // is re-read from the locked row below, so a limit that changes in between is still honoured.
  const [peek]: { seat_limit: number | null }[] = await manager.query(
    'SELECT seat_limit FROM schools WHERE id = $1',
    [tenantId],
  );
  if (!peek || peek.seat_limit === null) return;

  const [locked]: { seat_limit: number | null }[] = await manager.query(
    'SELECT seat_limit FROM schools WHERE id = $1 FOR UPDATE',
    [tenantId],
  );
  if (!locked || locked.seat_limit === null) return;

  const limit = locked.seat_limit;
  const used = await countSeats(manager, tenantId);
  if (used + count > limit) {
    throw new ConflictException({
      message: `Seat limit reached: ${used} of ${limit} seats in use`,
      details: { code: 'SEAT_LIMIT_REACHED', used, limit, requested: count },
    });
  }
}

/** Read-only usage for previews; takes no lock. */
export async function getSeatUsage(manager: EntityManager, tenantId: string): Promise<SeatUsage> {
  const [school]: { seat_limit: number | null }[] = await manager.query(
    'SELECT seat_limit FROM schools WHERE id = $1',
    [tenantId],
  );
  return { used: await countSeats(manager, tenantId), limit: school?.seat_limit ?? null };
}

@Injectable()
export class SeatLimitService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async usage(
    tenantId: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<SeatUsage> {
    return getSeatUsage(manager, tenantId);
  }

  assertCanAdd(tenantId: string, count: number, manager: EntityManager): Promise<void> {
    return assertSeatsAvailable(manager, tenantId, count);
  }
}
