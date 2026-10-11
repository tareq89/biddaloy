import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { LeaveStatus, LeaveType, PeriodSlotKind, UserRole } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';
import { School } from '../schools/entities/school.entity';
import { User } from '../users/entities/user.entity';
import { Teacher } from '../academics/entities/teacher.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { StaffProfile } from '../staff-profiles/entities/staff-profile.entity';
import { LeaveRecord } from '../leave/entities/leave-record.entity';
import { Shift } from './entities/shift.entity';
import { PeriodSlot } from './entities/period-slot.entity';
import { ResolveRoutineService } from './resolve-routine.service';
import { TeacherBusyService } from './teacher-busy.service';

/**
 * TEN-07: `busyAt` against a real DB. The resolver is stubbed (it has its
 * own integration specs) — what is under test is the join of resolved
 * slots with period times, exam duty, leave, and tenant eligibility.
 */
describe('TeacherBusyService (integration)', () => {
  let ds: DataSource;
  let service: TeacherBusyService;
  let resolved: Record<string, any[]>; // tenantId -> ResolvedSlot[]

  const A = SEED_TENANT_ID;
  const B = '00000000-0000-4000-8000-0000000b0b02';
  const DATE = '2026-06-01';

  let periodSlotId: string; // 08:00-08:40 in tenant A
  let teacher: { id: string; user_id: string };
  let actor: User;

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [
        TeacherBusyService,
        {
          provide: ResolveRoutineService,
          useValue: { resolveTenantDay: async (t: string) => resolved[t] ?? [] },
        },
      ],
      [],
      { synchronize: true, dropSchema: true },
    );
    ds = module.get<DataSource>(getDataSourceToken());
    service = module.get(TeacherBusyService);
  }, 60000);

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  async function member(userId: string, tenantId: string, role = UserRole.TEACHER) {
    await ds.getRepository(UserTenant).save({ user_id: userId, tenant_id: tenantId, role });
  }

  async function seedPeriod(tenantId: string, start: string, end: string) {
    const shift = await ds.getRepository(Shift).save({
      tenant_id: tenantId,
      name: `S-${randomUUID()}`,
      day_starts_at: '07:00:00',
      day_ends_at: '15:00:00',
      sequence: 0,
    });
    return ds.getRepository(PeriodSlot).save({
      tenant_id: tenantId,
      shift_id: shift.id,
      sequence: 0,
      kind: PeriodSlotKind.CLASS,
      starts_at: start,
      ends_at: end,
    });
  }

  const slot = (periodId: string, teacherIds: string[], extra: object = {}) => ({
    routine_slot_id: randomUUID(),
    period_slot_id: periodId,
    teacher_ids: teacherIds,
    cancelled: false,
    ...extra,
  });

  const ask = (over: Record<string, any> = {}) =>
    service.busyAt({
      tenantId: A,
      userId: teacher.user_id,
      date: DATE,
      from: '08:20',
      to: '09:00',
      actorUserId: actor.id,
      ...over,
    } as any);

  beforeEach(async () => {
    resolved = {};
    const schools = ds.getRepository(School);
    await schools.save({ id: A, name: 'College', slug: 'tb-a' });
    await schools.save({ id: B, name: 'High School', slug: 'tb-b' });
    const users = ds.getRepository(User);
    const u = await users.save({ full_name: 'Karim', email: `k-${randomUUID()}@t.local` });
    actor = await users.save({ full_name: 'Admin', email: `a-${randomUUID()}@t.local` });
    await member(u.id, A);
    await member(actor.id, A, UserRole.ADMIN);
    teacher = await ds
      .getRepository(Teacher)
      .save({ tenant_id: A, user_id: u.id, employee_id: `E-${randomUUID()}` });
    periodSlotId = (await seedPeriod(A, '08:00:00', '08:40:00')).id;
  });

  it('teaching another section at an overlapping period -> TEACHING', async () => {
    resolved[A] = [slot(periodSlotId, [teacher.id])];
    expect(await ask()).toMatchObject({
      kind: 'TEACHING',
      tenantId: A,
      tenantName: 'College',
      from: '08:00',
      to: '08:40',
    });
  });

  it('a non-overlapping period -> null', async () => {
    resolved[A] = [slot(periodSlotId, [teacher.id])];
    expect(await ask({ from: '08:40', to: '09:20' })).toBeNull();
  });

  it('covering another slot by substitution that day -> TEACHING (teacher_ids already reflects it)', async () => {
    resolved[A] = [slot(periodSlotId, [teacher.id], { substituted: true })];
    expect((await ask())?.kind).toBe('TEACHING');
  });

  it('own slot cancelled that day -> null; the excluded slot is ignored', async () => {
    resolved[A] = [slot(periodSlotId, [teacher.id], { cancelled: true })];
    expect(await ask()).toBeNull();
    const live = slot(periodSlotId, [teacher.id]);
    resolved[A] = [live];
    expect(await ask({ exclude: { routineSlotId: live.routine_slot_id } })).toBeNull();
  });

  async function leave(status: LeaveStatus) {
    // Saving a Teacher already creates its staff profile.
    const sp = await ds
      .getRepository(StaffProfile)
      .findOneByOrFail({ tenant_id: A, user_id: teacher.user_id });
    await ds.getRepository(LeaveRecord).save({
      tenant_id: A,
      staff_profile_id: sp.id,
      leave_type: LeaveType.SICK,
      start_date: '2026-05-30',
      end_date: '2026-06-02',
      days: 4,
      status,
    });
  }

  it('approved leave on the date -> ON_LEAVE', async () => {
    await leave(LeaveStatus.APPROVED);
    expect((await ask())?.kind).toBe('ON_LEAVE');
  });

  it('a PENDING leave -> null', async () => {
    await leave(LeaveStatus.PENDING);
    expect(await ask()).toBeNull();
  });

  async function seedExamDuty(planId: string, roomId: string, start: string, end: string) {
    // Throwaway rows for the FK columns: FK checks off for this connection only.
    const qr = ds.createQueryRunner();
    await qr.connect();
    try {
      await qr.query('SET session_replication_role = replica');
      const sched = randomUUID();
      await qr.query(
        `INSERT INTO exam_schedules (id, tenant_id, exam_id, subject_id, date, starts_at, ends_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [sched, A, randomUUID(), randomUUID(), DATE, start, end],
      );
      await qr.query(
        `INSERT INTO seat_allocations (id, tenant_id, seat_plan_id, exam_schedule_id, student_id, room_id, seat_number, invigilator_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, '1', $7)`,
        [randomUUID(), A, planId, sched, randomUUID(), roomId, teacher.user_id],
      );
    } finally {
      await qr.query('SET session_replication_role = DEFAULT');
      await qr.release();
    }
  }

  it('invigilating an overlapping exam -> INVIGILATING, unless that room is excluded', async () => {
    const plan = randomUUID();
    const room = randomUUID();
    await seedExamDuty(plan, room, '08:30:00', '10:00:00');
    expect(await ask()).toMatchObject({ kind: 'INVIGILATING', from: '08:30', to: '10:00' });
    expect(await ask({ exclude: { seatPlanId: plan, roomId: room } })).toBeNull();
  });

  it('cross-branch: busy in tenant A, actor ADMIN in A and B -> hit with the branch name', async () => {
    await member(teacher.user_id, B);
    await member(actor.id, B, UserRole.ADMIN);
    resolved[A] = [slot(periodSlotId, [teacher.id])];
    expect(await ask({ tenantId: B })).toMatchObject({ kind: 'TEACHING', tenantName: 'College' });
  });

  it('actor member of B only -> null (A is never read)', async () => {
    const other = await ds
      .getRepository(User)
      .save({ full_name: 'Bob', email: `b-${randomUUID()}@t.local` });
    await member(other.id, B, UserRole.ADMIN);
    await member(teacher.user_id, B);
    resolved[A] = [slot(periodSlotId, [teacher.id])];
    expect(await ask({ tenantId: B, actorUserId: other.id })).toBeNull();
  });
});
