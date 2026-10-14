import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { LeaveStatus, Permission, STAFF_ROLES, roleHasPermission } from '@biddaloy/shared';
import { ResolveRoutineService } from './resolve-routine.service';

export type BusyKind = 'TEACHING' | 'INVIGILATING' | 'ON_LEAVE';

export interface BusyHit {
  kind: BusyKind;
  tenantId: string;
  tenantName: string;
  /** `HH:mm`. */
  from: string;
  to: string;
}

export interface BusyAtInput {
  tenantId: string;
  userId: string;
  date: string;
  /** `HH:mm` (seconds tolerated). */
  from: string;
  to: string;
  /** The person doing the booking; decides which other branches are checked. */
  actorUserId: string;
  /** Rows to ignore: the slot or room being edited. */
  exclude?: { routineSlotId?: string; seatPlanId?: string; roomId?: string };
}

/**
 * [58.0.03] The one rule for reading ANOTHER branch's timetable on the actor's
 * behalf: the actor is a live member there with a staff role that can read
 * routines. ROUTINE_READ alone is not enough: PARENT and STUDENT hold it for
 * their own family's timetable, not the staff one. Shared by `busyAt` and the
 * routine save's cross-branch clash read (`RoutineSlotsService`).
 *
 * The clash checks therefore depend on WHO saves (D12): an admin of one
 * branch only cannot see, and so cannot be stopped by, a shared teacher's
 * slots in a branch they do not staff. It is not a platform-wide guarantee.
 */
const TIMETABLE_ROLES = STAFF_ROLES.filter((r) => roleHasPermission(r, Permission.ROUTINE_READ))
  .map((r) => `'${r}'`)
  .join(', ');
export const actorIsStaffIn = (actorRef: string, tenantRef: string): string =>
  `EXISTS (SELECT 1 FROM user_tenants ut WHERE ut.user_id = ${actorRef}
     AND ut.tenant_id = ${tenantRef} AND ut.deleted_at IS NULL
     AND ut.role::text IN (${TIMETABLE_ROLES}))`;

const hhmm = (t: string) => t.slice(0, 5);
// Same wall-clock rule as `constraint-check.ts` `slotsOverlapInTime`.
const overlaps = (aFrom: string, aTo: string, bFrom: string, bTo: string) =>
  aFrom < bTo && bFrom < aTo;

/**
 * TEN-07: is this person already teaching, invigilating or on approved
 * leave at an overlapping time? Checks the given tenant plus every other
 * tenant where the person works AND the acting user is a live member (so
 * a branch the actor has no access to is never read). Returns the first
 * clash, or `null`. Callers show `tenantName` only, never the other
 * branch's sections, subjects or students.
 */
@Injectable()
export class TeacherBusyService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly resolver: ResolveRoutineService,
  ) {}

  async busyAt(i: BusyAtInput): Promise<BusyHit | null> {
    const from = hhmm(i.from);
    const to = hhmm(i.to);
    for (const t of await this.eligibleTenants(i)) {
      const hit =
        (await this.teaching(t, i, from, to)) ??
        (await this.invigilating(t, i, from, to)) ??
        (await this.onLeave(t, i, from, to));
      if (hit) return hit;
    }
    return null;
  }

  private eligibleTenants(i: BusyAtInput): Promise<{ id: string; name: string }[]> {
    return this.ds.query(
      `SELECT s.id, s.name FROM schools s
       WHERE s.id = $1
          OR (s.id IN (SELECT tenant_id FROM teachers WHERE user_id = $2 AND deleted_at IS NULL
                       UNION SELECT tenant_id FROM user_tenants WHERE user_id = $2 AND deleted_at IS NULL)
              AND ${actorIsStaffIn('$3', 's.id')})
       ORDER BY (s.id = $1) DESC, s.name`,
      [i.tenantId, i.userId, i.actorUserId],
    );
  }

  private async teaching(
    t: { id: string; name: string },
    i: BusyAtInput,
    from: string,
    to: string,
  ): Promise<BusyHit | null> {
    const [teacher] = await this.ds.query(
      `SELECT id FROM teachers WHERE tenant_id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [t.id, i.userId],
    );
    if (!teacher) return null;
    // `teacher_ids` already reflects substitutions; cancelled slots drop out.
    const mine = (await this.resolver.resolveTenantDay(t.id, i.date)).filter(
      (s) =>
        !s.cancelled &&
        s.teacher_ids.includes(teacher.id) &&
        s.routine_slot_id !== i.exclude?.routineSlotId,
    );
    // The slot's own times are dated, so a special timing (#2290) moves them.
    const p = mine.find((s) => overlaps(from, to, hhmm(s.starts_at), hhmm(s.ends_at)));
    return p ? hit('TEACHING', t, p.starts_at, p.ends_at) : null;
  }

  private async invigilating(
    t: { id: string; name: string },
    i: BusyAtInput,
    from: string,
    to: string,
  ): Promise<BusyHit | null> {
    const [row] = await this.ds.query(
      `SELECT e.starts_at, e.ends_at
       FROM seat_allocations a
       -- A deleted plan keeps its allocation rows; they book nobody. Drafts
       -- still count (two drafts could both be published later).
       JOIN seat_plans sp ON sp.id = a.seat_plan_id AND sp.tenant_id = a.tenant_id
                         AND sp.deleted_at IS NULL
       JOIN exam_schedules e ON e.id = a.exam_schedule_id AND e.tenant_id = a.tenant_id
       WHERE a.tenant_id = $1 AND a.invigilator_user_id = $2 AND e.date = $3
         AND e.deleted_at IS NULL
         AND e.starts_at < $5::time AND $4::time < e.ends_at
         AND NOT (a.seat_plan_id IS NOT DISTINCT FROM $6::uuid AND a.room_id IS NOT DISTINCT FROM $7::uuid)
       LIMIT 1`,
      [t.id, i.userId, i.date, from, to, i.exclude?.seatPlanId ?? null, i.exclude?.roomId ?? null],
    );
    return row ? hit('INVIGILATING', t, row.starts_at, row.ends_at) : null;
  }

  private async onLeave(
    t: { id: string; name: string },
    i: BusyAtInput,
    from: string,
    to: string,
  ): Promise<BusyHit | null> {
    const [row] = await this.ds.query(
      `SELECT 1 FROM leave_records l
       JOIN staff_profiles sp ON sp.id = l.staff_profile_id AND sp.tenant_id = l.tenant_id
       WHERE l.tenant_id = $1 AND sp.user_id = $2 AND l.status = $3
         AND l.start_date <= $4 AND $4 <= l.end_date
       LIMIT 1`,
      [t.id, i.userId, LeaveStatus.APPROVED, i.date],
    );
    // Leave covers the whole day, so report the asked-for window.
    return row ? hit('ON_LEAVE', t, from, to) : null;
  }
}

function hit(kind: BusyKind, t: { id: string; name: string }, from: string, to: string): BusyHit {
  return { kind, tenantId: t.id, tenantName: t.name, from: hhmm(from), to: hhmm(to) };
}
