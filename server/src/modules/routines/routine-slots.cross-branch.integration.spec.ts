import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { DataSource, EntityManager } from 'typeorm';
import { ConflictException } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { School } from '../schools/entities/school.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Subject } from '../academics/entities/subject.entity';
import { Teacher } from '../academics/entities/teacher.entity';
import { User } from '../users/entities/user.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { Shift } from './entities/shift.entity';
import { PeriodSlot } from './entities/period-slot.entity';
import { Routine } from './entities/routine.entity';
import { RoutineSlotsService } from './routine-slots.service';
import { SchoolSettingsReader } from '../schools/settings/school-settings-reader.service';
import { AuditService } from '../audit/audit.service';
import { SchoolsService } from '../schools/schools.service';
import { PeriodSlotKind, RoutineState, SlotRecurrence, UserRole } from '@biddaloy/shared';

/**
 * [58.0.03] D12: one person teaching in two branches (tenants) cannot be
 * booked at overlapping wall-clock times. The check reads another branch
 * only if the ACTING user is a member there, and the error carries only
 * "busy at that period" (branch name, weekday, period name).
 */
describe('RoutineSlotsService — cross-branch teacher clash (D12)', () => {
  let dataSource: DataSource;
  let service: RoutineSlotsService;

  // Fresh pair of branches per scenario (one current year per tenant).
  let TENANT_A = '';
  let TENANT_B = '';

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [
        RoutineSlotsService,
        AuditService,
        { provide: SchoolsService, useValue: { getResolvedSettings: async () => ({}) } },
        { provide: SchoolSettingsReader, useValue: { routineSettings: async () => ({}) } },
      ],
      [],
      { synchronize: true, dropSchema: true },
    );
    dataSource = module.get<DataSource>(getDataSourceToken());
    service = module.get(RoutineSlotsService);
  }, 60000);

  afterAll(async () => {
    await dataSource.destroy();
  });
  afterEach(() => vi.restoreAllMocks());

  let n = 0;
  async function makeUser(label: string) {
    n += 1;
    return dataSource
      .getRepository(User)
      .save({ full_name: label, email: `${label}-${n}@test.local` });
  }

  /** One branch: a year, one section, a period (08:00-08:40 unless given), a draft routine. */
  async function seedBranch(
    tenantId: string,
    teacherUserId: string,
    opts: { start?: string; end?: string; isCurrent?: boolean } = {},
  ) {
    n += 1;
    const year = await dataSource.getRepository(AcademicYear).save({
      tenant_id: tenantId,
      name: `Y-${n}`,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      is_current: opts.isCurrent ?? true,
    });
    const shift = await dataSource.getRepository(Shift).save({
      tenant_id: tenantId,
      name: `Shift-${n}`,
      day_starts_at: '07:00:00',
      day_ends_at: '15:00:00',
      sequence: n,
    });
    const periodSlot = await dataSource.getRepository(PeriodSlot).save({
      tenant_id: tenantId,
      shift_id: shift.id,
      sequence: 0,
      kind: PeriodSlotKind.CLASS,
      name: 'Period 3',
      starts_at: opts.start ?? '08:00:00',
      ends_at: opts.end ?? '08:40:00',
    });
    const klass = await dataSource.getRepository(Class).save({
      tenant_id: tenantId,
      academic_year_id: year.id,
      name: `Class-${n}`,
      shift_id: shift.id,
    });
    const section = await dataSource
      .getRepository(ClassSection)
      .save({ tenant_id: tenantId, class_id: klass.id, section_name: 'A' });
    const subject = await dataSource
      .getRepository(Subject)
      .save({ tenant_id: tenantId, name_en: `Sub-${n}`, code: `S-${n}` });
    const teacher = await dataSource
      .getRepository(Teacher)
      .save({ tenant_id: tenantId, user_id: teacherUserId, employee_id: `E-${n}` });
    const routine = await dataSource.getRepository(Routine).save({
      tenant_id: tenantId,
      academic_year_id: year.id,
      name: `R-${n}`,
      state: RoutineState.DRAFT,
      published_at: null,
    });
    return { year, routine, periodSlot, section, subject, teacher };
  }

  const dto = (b: Awaited<ReturnType<typeof seedBranch>>) =>
    ({
      section_id: b.section.id,
      period_slot_id: b.periodSlot.id,
      weekday: 0,
      subject_id: b.subject.id,
      room_id: null,
      recurrence: SlotRecurrence.WEEKLY,
      recurrence_offset: 0,
      valid_from: '2026-01-01',
      valid_to: null,
      teacher_ids: [b.teacher.id],
    }) as any;

  async function member(userId: string, tenantId: string) {
    await dataSource
      .getRepository(UserTenant)
      .save({ user_id: userId, tenant_id: tenantId, role: UserRole.ADMIN });
  }

  /** T teaches Sunday 08:00-08:40 in branch A. Returns both branches. */
  async function scenario(bTimes: { start?: string; end?: string } = {}, aCurrent = true) {
    const schools = dataSource.getRepository(School);
    const [sa, sb] = await Promise.all([
      schools.save({ name: 'North Branch', slug: `north-${++n}` }),
      schools.save({ name: 'South Branch', slug: `south-${++n}` }),
    ]);
    TENANT_A = sa.id;
    TENANT_B = sb.id;
    const teacherUser = await makeUser('teacher');
    const actor = await makeUser('actor');
    const a = await seedBranch(TENANT_A, teacherUser.id, { isCurrent: aCurrent });
    const b = await seedBranch(TENANT_B, teacherUser.id, bTimes);
    // Branch A's own save has no foreign branch to compare with.
    await service.create(a.routine.id, dto(a), TENANT_A, actor.id);
    return { actor, a, b };
  }

  it('blocks when the actor is ADMIN in both branches, naming branch, weekday and period', async () => {
    const { actor, b } = await scenario({ start: '08:20:00', end: '09:00:00' });
    await member(actor.id, TENANT_A);
    await member(actor.id, TENANT_B);

    const err = await service.create(b.routine.id, dto(b), TENANT_B, actor.id).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    const [v] = err.getResponse().details.violations;
    expect(v.code).toBe('TEACHER_DOUBLE_BOOKED');
    expect(v.details).toEqual({ tenantName: 'North Branch', weekday: 0, periodName: 'Period 3' });
    // Nothing else about branch A leaks (no class names).
    expect(JSON.stringify(err.getResponse())).not.toContain('Class-');
  });

  it('saves when the actor is a member only of the branch being written, and reads nothing from A', async () => {
    const { actor, b } = await scenario({ start: '08:20:00', end: '09:00:00' });
    await member(actor.id, TENANT_B);

    const spy = vi.spyOn(EntityManager.prototype, 'query');
    const res = await service.create(b.routine.id, dto(b), TENANT_B, actor.id);
    expect(res.slot.id).toBeDefined();
    // Query log proof: no row from branch A came back from the cross-branch query.
    const returned = (await Promise.all(spy.mock.results.map((r) => r.value))).flat();
    expect(JSON.stringify(returned)).not.toContain('North Branch');
    // ...and the lookup really ran (membership join present) and came back empty.
    const lookup = spy.mock.calls.findIndex(([sql]) => String(sql).includes('user_tenants'));
    expect(lookup).toBeGreaterThanOrEqual(0);
    expect(await spy.mock.results[lookup].value).toEqual([]);
  });

  it('saves when the times do not overlap', async () => {
    const { actor, b } = await scenario({ start: '09:00:00', end: '09:40:00' });
    await member(actor.id, TENANT_A);
    await member(actor.id, TENANT_B);
    const res = await service.create(b.routine.id, dto(b), TENANT_B, actor.id);
    expect(res.slot.id).toBeDefined();
  });

  it("does not block on a slot in the other branch's non-current year", async () => {
    const { actor, b } = await scenario({ start: '08:20:00', end: '09:00:00' }, false);
    await member(actor.id, TENANT_A);
    await member(actor.id, TENANT_B);
    const res = await service.create(b.routine.id, dto(b), TENANT_B, actor.id);
    expect(res.slot.id).toBeDefined();
  });
});
