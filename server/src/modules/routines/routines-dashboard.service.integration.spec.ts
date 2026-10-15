import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import {
  SEED_ACADEMIC_YEAR_ID,
  SEED_ADMIN_USER_ID,
  SEED_SECTION_1_ID,
  SEED_SECTION_2_ID,
  SEED_TENANT_ID,
} from '@test/constants';
import { RoutineState, TeacherAssignmentType, UserRole } from '@biddaloy/shared';
import { RoutinesModule } from './routines.module';
import { AuthModule } from '../auth/auth.module';
import { RoutinesDashboardService } from './routines-dashboard.service';
import { ResolveRoutineService } from './resolve-routine.service';
import { seedPeriodRoutine } from '../attendance/attendance-periods.fixture';
import { School } from '../schools/entities/school.entity';
import { User } from '../users/entities/user.entity';
import { Teacher } from '../academics/entities/teacher.entity';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { Room } from './entities/room.entity';
import { RoutineSlot } from './entities/routine-slot.entity';
import { RoutineSlotTeacher } from './entities/routine-slot-teacher.entity';
import { RoutineSubstitution } from './entities/routine-substitution.entity';

/**
 * [8.10.7.3.01] "My routine today" widget. Periods must equal what
 * `ResolveRoutineService` returns for the same teacher and day.
 */
describe('RoutinesDashboardService (integration)', () => {
  let service: RoutinesDashboardService;
  let resolver: ResolveRoutineService;
  let ds: DataSource;

  const TODAY = '2026-03-04'; // Wednesday, inside the seeded academic year
  const NOW = new Date(`${TODAY}T06:00:00Z`);
  const OTHER_TENANT = '00000000-0000-4000-8000-000000000096';
  let n = 0;

  async function mkTeacher(tenantId = SEED_TENANT_ID) {
    n += 1;
    const user = await ds.getRepository(User).save({
      email: `rtd-${Date.now()}-${n}@test.com`,
      full_name: `Teacher ${n}`,
    });
    const teacher = await ds.getRepository(Teacher).save({
      user_id: user.id,
      employee_id: `RTD-${Date.now()}-${n}`,
      designations: [],
      tenant_id: tenantId,
    });
    return { user, teacher };
  }

  const seed = (teacherId: string, periods = 3, state: RoutineState = RoutineState.PUBLISHED) =>
    seedPeriodRoutine(ds, {
      tenantId: SEED_TENANT_ID,
      academicYearId: SEED_ACADEMIC_YEAR_ID,
      sectionId: SEED_SECTION_1_ID,
      date: TODAY,
      periods,
      teacherId,
      createdBy: SEED_ADMIN_USER_ID,
      state,
    });

  const run = (userId: string, role: string = UserRole.TEACHER) =>
    service.myRoutineToday(SEED_TENANT_ID, { userId, role });

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [],
      [ConfigModule.forRoot({ isGlobal: true }), RoutinesModule, AuthModule],
    );
    service = module.get(RoutinesDashboardService);
    resolver = module.get(ResolveRoutineService);
    ds = module.get<DataSource>(getDataSourceToken());
    const schools = ds.getRepository(School);
    if (!(await schools.findOne({ where: { id: OTHER_TENANT } }))) {
      await schools.save({
        id: OTHER_TENANT,
        name: 'Routine Dash Other',
        slug: 'routine-dash-other',
      });
    }
  }, 60000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  beforeEach(async () => {
    await ds
      .getRepository(School)
      .update(
        { id: SEED_TENANT_ID },
        { settings: { version: 1, attendance: { weeklyOffDays: [5] } } as any },
      );
    await ds.query(`DELETE FROM routine_substitutions WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await ds.query(`DELETE FROM routine_slot_teachers WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await ds.query(`DELETE FROM routine_slots WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await ds.query(`DELETE FROM routines WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await ds.query(`DELETE FROM teacher_class_sections WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('lists periods sorted by time with room labels and a covering flag', async () => {
    const { user, teacher } = await mkTeacher();
    const { slots } = await seed(teacher.id, 2);
    const other = await mkTeacher();
    // third period: another teacher's slot (section 2) that this teacher covers today
    const { id: _id, ...copy } = slots[0].routineSlot;
    const covered = await ds
      .getRepository(RoutineSlot)
      .save({ ...copy, section_id: SEED_SECTION_2_ID });
    await ds.getRepository(RoutineSlotTeacher).save({
      tenant_id: SEED_TENANT_ID,
      routine_slot_id: covered.id,
      teacher_id: other.teacher.id,
    });
    await ds.getRepository(RoutineSubstitution).save({
      tenant_id: SEED_TENANT_ID,
      routine_slot_id: covered.id,
      date: TODAY,
      substitute_teacher_id: teacher.id,
      created_by: SEED_ADMIN_USER_ID,
    });
    const room = await ds.getRepository(Room).save({
      tenant_id: SEED_TENANT_ID,
      building: 'Main',
      room_no: '202',
    });
    await ds
      .getRepository(RoutineSlot)
      .update({ id: slots[0].routineSlot.id }, { room_id: room.id });

    const res = await run(user.id);
    expect(res.date).toBe(TODAY);
    expect(res.is_working_day).toBe(true);
    expect(res.periods).toHaveLength(3);
    const starts = res.periods.map((p) => p.starts_at);
    expect(starts).toEqual([...starts].sort());
    expect(starts[0]).toMatch(/^\d\d:\d\d$/);
    expect(res.periods.filter((p) => p.room_label === 'Main 202')).toHaveLength(1);
    expect(res.periods.filter((p) => p.room_label === null)).toHaveLength(2);
    expect(res.periods.filter((p) => p.covering)).toHaveLength(1);
  });

  it('keeps a cancelled substitution with cancelled: true', async () => {
    const { user, teacher } = await mkTeacher();
    const { cancel } = await seed(teacher.id, 2);
    await cancel(0);
    const res = await run(user.id);
    expect(res.periods).toHaveLength(2);
    expect(res.periods.filter((p) => p.cancelled)).toHaveLength(1);
  });

  it('is_homeroom is true only for a CLASS_TEACHER section', async () => {
    const { user, teacher } = await mkTeacher();
    const { slots } = await seed(teacher.id, 1);
    // The DB requires a subject on SUBJECT_TEACHER rows and none on class-teacher rows.
    const assign = (assignment_type: TeacherAssignmentType) =>
      ds.getRepository(TeacherClassSection).save({
        tenant_id: SEED_TENANT_ID,
        teacher_id: teacher.id,
        section_id: SEED_SECTION_1_ID,
        assignment_type,
        subject_id:
          assignment_type === TeacherAssignmentType.SUBJECT_TEACHER ? slots[0].subject.id : null,
      });
    await assign(TeacherAssignmentType.CLASS_TEACHER);
    expect((await run(user.id)).periods[0].is_homeroom).toBe(true);
    await ds.query(`DELETE FROM teacher_class_sections WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await assign(TeacherAssignmentType.SUBJECT_TEACHER);
    expect((await run(user.id)).periods[0].is_homeroom).toBe(false);
  });

  it('next_day skips a weekly off day', async () => {
    const { user, teacher } = await mkTeacher();
    const { slots } = await seed(teacher.id, 1);
    // Same period also on Friday (weekly off): skipped, so next Wednesday wins.
    const { id: _id, ...copy } = slots[0].routineSlot;
    await ds.getRepository(RoutineSlot).save({ ...copy, weekday: 5 });
    const res = await run(user.id);
    expect(res.next_day?.date).toBe('2026-03-11');
    expect(res.next_day).toHaveProperty('class_name');
    expect(res.next_day).toHaveProperty('subject_name_en');
  });

  it('no teacher row -> empty periods, next_day null', async () => {
    const user = await ds.getRepository(User).save({
      email: `rtd-none-${Date.now()}@test.com`,
      full_name: 'No Teacher',
    });
    const res = await run(user.id);
    expect(res.periods).toEqual([]);
    expect(res.next_day).toBeNull();
    expect(res.date).toBe(TODAY);
  });

  it('DRAFT routine is empty for a TEACHER', async () => {
    const { user, teacher } = await mkTeacher();
    await seed(teacher.id, 2, RoutineState.DRAFT);
    const res = await run(user.id);
    expect(res.periods).toEqual([]);
    expect(res.next_day).toBeNull();
  });

  it("another tenant's teacher row for the same user is never used", async () => {
    const { user } = await mkTeacher(OTHER_TENANT);
    const { teacher } = await mkTeacher();
    await seed(teacher.id, 2); // belongs to a different user
    expect((await run(user.id)).periods).toEqual([]);
  });

  it('Dhaka midnight: 18:30Z on the 7th is the 8th', async () => {
    vi.setSystemTime(new Date('2026-10-07T18:30:00Z'));
    const { user } = await mkTeacher();
    expect((await run(user.id)).date).toBe('2026-10-08');
  });

  it('periods equal the resolver output for the same teacher and day', async () => {
    const { user, teacher } = await mkTeacher();
    await seed(teacher.id, 3);
    const res = await run(user.id);
    const resolved = await resolver.resolveRoutine(
      { teacher_id: teacher.id, from: TODAY, to: TODAY },
      SEED_TENANT_ID,
      { role: UserRole.TEACHER, userId: user.id },
    );
    expect(res.periods.map((p) => p.starts_at)).toEqual(
      resolved.map((s) => s.starts_at.slice(0, 5)).sort(),
    );
  });
});
