import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { EnrollmentStatus, ExamKind, ExamStatus, SeatOrderMode } from '@biddaloy/shared';
import { SeatPlansService } from './seat-plans.service';
import { SeatPlansDashboardService } from './seat-plans-dashboard.service';
import { TeacherBusyService } from '../routines/teacher-busy.service';
import { ResolveRoutineService } from '../routines/resolve-routine.service';
import { ExamSchedule } from '../exams/entities/exam-schedule.entity';
import { Exam } from '../exams/entities/exam.entity';
import { Subject } from '../academics/entities/subject.entity';
import { Room } from '../routines/entities/room.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Class } from '../academics/entities/class.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { School } from '../schools/entities/school.entity';
import { Student } from '../students/entities/student.entity';
import { Enrollment } from '../students/entities/enrollment.entity';
import { localToday } from '../../common/time';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';

/** [8.10.7.4.11] seat-plan-status widget service against a real Postgres. */
describe('SeatPlansDashboardService (integration)', () => {
  let widget: SeatPlansDashboardService;
  let plans: SeatPlansService;
  let ds: DataSource;

  const OTHER_TENANT_ID = '00000000-0000-4000-8000-000001892001';
  const AY = '00000000-0000-4000-8000-000001892010';
  const OTHER_AY = '00000000-0000-4000-8000-000001892011';
  const CLASS = '00000000-0000-4000-8000-000001892012';
  const OTHER_CLASS = '00000000-0000-4000-8000-000001892013';
  const SECTION = '00000000-0000-4000-8000-000001892014';
  const ROOM = '00000000-0000-4000-8000-000001892015';
  const SUBJECTS = [0, 1, 2].map((i) => `00000000-0000-4000-8000-00000189202${i}`);
  const TODAY = '2026-10-15';

  let seq = 0;
  const id = () => `00000000-0000-4000-8000-0000018930${String(++seq).padStart(2, '0')}`;

  async function makeExam(
    name: string,
    dates: string[],
    opts: { tenantId?: string; classId?: string; ay?: string } = {},
  ) {
    const tenant_id = opts.tenantId ?? SEED_TENANT_ID;
    const exam = await ds.getRepository(Exam).save(
      ds.getRepository(Exam).create({
        id: id(),
        academic_year_id: opts.ay ?? AY,
        class_id: opts.classId ?? CLASS,
        name,
        kind: ExamKind.TERM,
        status: ExamStatus.DRAFT,
        tenant_id,
      }),
    );
    const schedules: ExamSchedule[] = [];
    for (const [i, date] of dates.entries()) {
      schedules.push(
        await ds.getRepository(ExamSchedule).save(
          ds.getRepository(ExamSchedule).create({
            id: id(),
            exam_id: exam.id,
            subject_id: SUBJECTS[i % 3],
            date,
            starts_at: '09:00:00',
            ends_at: '11:00:00',
            tenant_id,
          }),
        ),
      );
    }
    return { exam, schedules };
  }

  const plan = async (scheduleIds: string[], name = 'plan') =>
    (
      await plans.generate(SEED_TENANT_ID, {
        name,
        exam_schedule_ids: scheduleIds,
        room_ids: [ROOM],
        seat_order_mode: SeatOrderMode.SEQUENTIAL,
      })
    ).plan;

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [
        SeatPlansService,
        SeatPlansDashboardService,
        TeacherBusyService,
        { provide: ResolveRoutineService, useValue: { resolveTenantDay: async () => [] } },
      ],
      [],
      { synchronize: true, dropSchema: true },
    );
    widget = module.get(SeatPlansDashboardService);
    plans = module.get(SeatPlansService);
    ds = module.get(DataSource);
  });

  // Reference data is re-seeded per test (the global beforeEach wipes all but school/AY/class tables).
  beforeEach(async () => {
    seq = 0;
    await ds.query('DELETE FROM class_sections');
    await ds.query('DELETE FROM classes');
    await ds.query('DELETE FROM academic_years');
    await ds.query('DELETE FROM schools');
    for (const [tid, slug] of [
      [SEED_TENANT_ID, 'sp-dash-a'],
      [OTHER_TENANT_ID, 'sp-dash-b'],
    ]) {
      await ds
        .getRepository(School)
        .save(ds.getRepository(School).create({ id: tid, name: slug, slug, tenant_id: tid }));
    }
    for (const [aid, tid] of [
      [AY, SEED_TENANT_ID],
      [OTHER_AY, OTHER_TENANT_ID],
    ]) {
      await ds.getRepository(AcademicYear).save(
        ds.getRepository(AcademicYear).create({
          id: aid,
          name: '2026',
          start_date: new Date('2026-01-01'),
          end_date: new Date('2026-12-31'),
          is_current: true,
          tenant_id: tid,
        }),
      );
    }
    for (const [cid, tid, aid, name] of [
      [CLASS, SEED_TENANT_ID, AY, 'সপ্তম'],
      [OTHER_CLASS, OTHER_TENANT_ID, OTHER_AY, 'Other Seven'],
    ]) {
      await ds.getRepository(Class).save(
        ds.getRepository(Class).create({
          id: cid,
          name,
          academic_year_id: aid,
          tenant_id: tid,
        }),
      );
    }
    await ds.getRepository(ClassSection).save(
      ds.getRepository(ClassSection).create({
        id: SECTION,
        section_name: 'A',
        class_id: CLASS,
        tenant_id: SEED_TENANT_ID,
      }),
    );
    for (const [i, sid] of SUBJECTS.entries()) {
      await ds.getRepository(Subject).save(
        ds.getRepository(Subject).create({
          id: sid,
          name_en: `Subject ${i}`,
          name_bn: `বিষয় ${i}`,
          code: `S${i}`,
          tenant_id: SEED_TENANT_ID,
        }),
      );
    }
    await ds
      .getRepository(Room)
      .save(
        ds
          .getRepository(Room)
          .create({ id: ROOM, room_no: '101', capacity: 50, tenant_id: SEED_TENANT_ID }),
      );
    const student = await ds.getRepository(Student).save(
      ds.getRepository(Student).create({
        full_name: 'Student One',
        registration_number: 'REG-1892',
        roll_number: 1,
        class_section_id: SECTION,
        tenant_id: SEED_TENANT_ID,
      }),
    );
    await ds.getRepository(Enrollment).save(
      ds.getRepository(Enrollment).create({
        student_id: student.id,
        class_id: CLASS,
        section_id: SECTION,
        academic_year_id: AY,
        enrollment_status: EnrollmentStatus.ACTIVE,
        tenant_id: SEED_TENANT_ID,
      }),
    );
  });

  afterEach(() => vi.useRealTimers());
  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  it('3 schedules, 2 in a DRAFT plan: planned 2, published 0, needs a plan', async () => {
    const { exam, schedules } = await makeExam('Half yearly', [
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
    ]);
    await plan([schedules[0].id, schedules[1].id]);
    const res = await widget.getStatus(SEED_TENANT_ID, TODAY);
    expect(res.exams_needing_plan).toBe(1);
    expect(res.exams).toEqual([
      {
        exam_id: exam.id,
        exam_name: 'Half yearly',
        class_name: 'সপ্তম',
        first_date: '2026-11-02',
        schedule_count: 3,
        planned_count: 2,
        published_count: 0,
      },
    ]);
  });

  it('reconciles with generate + publish: planned = published = schedule_count, not needing a plan', async () => {
    const { schedules } = await makeExam('Half yearly', ['2026-11-02', '2026-11-03']);
    const p = await plan(schedules.map((s) => s.id));
    await plans.publish(SEED_TENANT_ID, p.id);
    const res = await widget.getStatus(SEED_TENANT_ID, TODAY);
    expect(res.exams_needing_plan).toBe(0);
    expect(res.exams[0]).toMatchObject({
      schedule_count: 2,
      planned_count: 2,
      published_count: 2,
    });
  });

  it('a soft-deleted seat plan does not count', async () => {
    const { schedules } = await makeExam('Half yearly', ['2026-11-02']);
    const p = await plan([schedules[0].id]);
    await ds.query('UPDATE seat_plans SET deleted_at = NOW() WHERE id = $1', [p.id]);
    const res = await widget.getStatus(SEED_TENANT_ID, TODAY);
    expect(res.exams[0]).toMatchObject({ planned_count: 0, published_count: 0 });
    expect(res.exams_needing_plan).toBe(1);
  });

  it('an exam whose first sitting was yesterday is not listed', async () => {
    await makeExam('Past', ['2026-10-14', '2026-11-20']);
    await makeExam('Today', [TODAY]);
    const res = await widget.getStatus(SEED_TENANT_ID, TODAY);
    expect(res.exams.map((e) => e.exam_name)).toEqual(['Today']);
  });

  it('12 upcoming exams: 10 rows by first_date, exams_needing_plan counts all 12', async () => {
    for (let i = 0; i < 12; i++) {
      await makeExam(`Exam ${String(i).padStart(2, '0')}`, [
        `2026-11-${String(i + 1).padStart(2, '0')}`,
      ]);
    }
    const res = await widget.getStatus(SEED_TENANT_ID, TODAY);
    expect(res.exams).toHaveLength(10);
    expect(res.exams[0].first_date).toBe('2026-11-01');
    expect(res.exams[9].first_date).toBe('2026-11-10');
    expect(res.exams_needing_plan).toBe(12);
  });

  // Host TZ must not matter: run this file under TZ=UTC and TZ=Asia/Dhaka.
  it('Dhaka midnight: 00:30 on 2 Nov drops a 1 Nov exam, keeps 2 Nov', async () => {
    await makeExam('Gone', ['2026-11-01']);
    await makeExam('Stays', ['2026-11-02']);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-01T18:30:00Z'));
    const res = await widget.getStatus(SEED_TENANT_ID, localToday());
    expect(res.exams.map((e) => e.exam_name)).toEqual(['Stays']);
  });

  it('tenant isolation: another school exam never leaks, and a foreign tenant sees only its own', async () => {
    await makeExam('Mine', ['2026-11-02']);
    await makeExam('Theirs', ['2026-11-02'], {
      tenantId: OTHER_TENANT_ID,
      classId: OTHER_CLASS,
      ay: OTHER_AY,
    });
    const mine = await widget.getStatus(SEED_TENANT_ID, TODAY);
    expect(mine.exams.map((e) => e.exam_name)).toEqual(['Mine']);
    const theirs = await widget.getStatus(OTHER_TENANT_ID, TODAY);
    expect(theirs.exams.map((e) => e.exam_name)).toEqual(['Theirs']);
  });
});
