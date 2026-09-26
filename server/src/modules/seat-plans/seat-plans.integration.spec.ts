import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { Repository, DataSource } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  EnrollmentStatus,
  ExamKind,
  ExamStatus,
  SeatOrderMode,
  SeatPlanStatus,
} from '@biddaloy/shared';
import { SeatPlansService } from './seat-plans.service';
import { SeatPlan } from './entities/seat-plan.entity';
import { SeatPlanSchedule } from './entities/seat-plan-schedule.entity';
import { SeatAllocation } from './entities/seat-allocation.entity';
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
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';

/**
 * End-to-end integration test for the seat-plan generate → edit → publish
 * flow (#1054's own acceptance criterion), against a real Postgres database.
 *
 * Covers: generating a plan across two subject-sittings from two different
 * classes into shared rooms, manually editing one seat, reshuffling one
 * room, publishing, and then asserting the covered schedules are locked
 * against reuse by a second `generate` call (D6).
 *
 * Reference data (school, academic year, classes, sections) is seeded once
 * in `beforeAll` — `test/setup.ts`'s global `beforeEach` only resets that
 * data once per spec *file*, not once per test. Everything downstream of it
 * here — subjects, exams, exam schedules, rooms, students, enrollments — is
 * one of `test/reset-order.ts`'s transactional tables, wiped by that same
 * global `beforeEach` before every test, so it has to be (re-)seeded in this
 * file's own `beforeEach` instead, or it would be gone by the time the `it`
 * block below runs.
 */
describe('SeatPlansService (integration)', () => {
  let service: SeatPlansService;
  let dataSource: DataSource;
  let seatPlanScheduleRepo: Repository<SeatPlanSchedule>;
  let allocationRepo: Repository<SeatAllocation>;

  const ACADEMIC_YEAR_ID = '00000000-0000-4000-8000-000000000120';
  const CLASS_1_ID = '00000000-0000-4000-8000-000000000121';
  const CLASS_2_ID = '00000000-0000-4000-8000-000000000122';
  const SECTION_1_ID = '00000000-0000-4000-8000-000000000123';
  const SECTION_2_ID = '00000000-0000-4000-8000-000000000124';
  const SUBJECT_ID = '00000000-0000-4000-8000-000000000125';
  const EXAM_1_ID = '00000000-0000-4000-8000-000000000126';
  const EXAM_2_ID = '00000000-0000-4000-8000-000000000127';
  const SCHEDULE_1_ID = '00000000-0000-4000-8000-000000000128';
  const SCHEDULE_2_ID = '00000000-0000-4000-8000-000000000129';
  const ROOM_1_ID = '00000000-0000-4000-8000-000000000130';
  const ROOM_2_ID = '00000000-0000-4000-8000-000000000131';

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [SeatPlansService], [], {
      synchronize: true,
      dropSchema: true,
    });

    service = module.get<SeatPlansService>(SeatPlansService);
    dataSource = module.get(DataSource);
    seatPlanScheduleRepo = module.get<Repository<SeatPlanSchedule>>(
      getRepositoryToken(SeatPlanSchedule),
    );
    allocationRepo = module.get<Repository<SeatAllocation>>(getRepositoryToken(SeatAllocation));

    // FK-safe cleanup, then seed the reference data this file reuses across
    // its (single) test: two classes, one section each.
    await dataSource.query('DELETE FROM class_sections');
    await dataSource.query('DELETE FROM classes');
    await dataSource.query('DELETE FROM academic_years');
    await dataSource.query('DELETE FROM schools');

    const schoolRepo = dataSource.getRepository(School);
    await schoolRepo.save(
      schoolRepo.create({
        id: SEED_TENANT_ID,
        name: 'Test School',
        slug: 'seat-plans-integration-school',
        tenant_id: SEED_TENANT_ID,
      }),
    );

    const ayRepo = dataSource.getRepository(AcademicYear);
    await ayRepo.save(
      ayRepo.create({
        id: ACADEMIC_YEAR_ID,
        name: '2026',
        start_date: new Date('2026-01-01'),
        end_date: new Date('2026-12-31'),
        is_current: true,
        tenant_id: SEED_TENANT_ID,
      }),
    );

    const classRepo = dataSource.getRepository(Class);
    await classRepo.save(
      classRepo.create({
        id: CLASS_1_ID,
        name: 'Class One',
        academic_year_id: ACADEMIC_YEAR_ID,
        tenant_id: SEED_TENANT_ID,
      }),
    );
    await classRepo.save(
      classRepo.create({
        id: CLASS_2_ID,
        name: 'Class Two',
        academic_year_id: ACADEMIC_YEAR_ID,
        tenant_id: SEED_TENANT_ID,
      }),
    );

    const sectionRepo = dataSource.getRepository(ClassSection);
    await sectionRepo.save(
      sectionRepo.create({
        id: SECTION_1_ID,
        section_name: 'A',
        class_id: CLASS_1_ID,
        tenant_id: SEED_TENANT_ID,
      }),
    );
    await sectionRepo.save(
      sectionRepo.create({
        id: SECTION_2_ID,
        section_name: 'A',
        class_id: CLASS_2_ID,
        tenant_id: SEED_TENANT_ID,
      }),
    );
  });

  beforeEach(async () => {
    // Everything from here down is a transactional table (reset before
    // every test by `test/setup.ts`'s global `beforeEach`, which runs
    // before this one), so it's re-seeded here rather than in `beforeAll`.
    const subjectRepo = dataSource.getRepository(Subject);
    await subjectRepo.save(
      subjectRepo.create({
        id: SUBJECT_ID,
        name_en: 'Mathematics',
        code: 'MATH',
        tenant_id: SEED_TENANT_ID,
      }),
    );

    const examRepo = dataSource.getRepository(Exam);
    await examRepo.save(
      examRepo.create({
        id: EXAM_1_ID,
        academic_year_id: ACADEMIC_YEAR_ID,
        class_id: CLASS_1_ID,
        name: 'Class One Term Exam',
        kind: ExamKind.TERM,
        status: ExamStatus.DRAFT,
        tenant_id: SEED_TENANT_ID,
      }),
    );
    await examRepo.save(
      examRepo.create({
        id: EXAM_2_ID,
        academic_year_id: ACADEMIC_YEAR_ID,
        class_id: CLASS_2_ID,
        name: 'Class Two Term Exam',
        kind: ExamKind.TERM,
        status: ExamStatus.DRAFT,
        tenant_id: SEED_TENANT_ID,
      }),
    );

    const scheduleRepo = dataSource.getRepository(ExamSchedule);
    await scheduleRepo.save(
      scheduleRepo.create({
        id: SCHEDULE_1_ID,
        exam_id: EXAM_1_ID,
        subject_id: SUBJECT_ID,
        date: '2026-06-01',
        starts_at: '09:00:00',
        ends_at: '11:00:00',
        tenant_id: SEED_TENANT_ID,
      }),
    );
    await scheduleRepo.save(
      scheduleRepo.create({
        id: SCHEDULE_2_ID,
        exam_id: EXAM_2_ID,
        subject_id: SUBJECT_ID,
        date: '2026-06-01',
        starts_at: '09:00:00',
        ends_at: '11:00:00',
        tenant_id: SEED_TENANT_ID,
      }),
    );

    const roomRepo = dataSource.getRepository(Room);
    await roomRepo.save(
      roomRepo.create({ id: ROOM_1_ID, room_no: '101', capacity: 10, tenant_id: SEED_TENANT_ID }),
    );
    await roomRepo.save(
      roomRepo.create({ id: ROOM_2_ID, room_no: '102', capacity: 10, tenant_id: SEED_TENANT_ID }),
    );

    const studentRepo = dataSource.getRepository(Student);
    const student1 = await studentRepo.save(
      studentRepo.create({
        full_name: 'Student One',
        registration_number: 'REG-001',
        roll_number: 1,
        class_section_id: SECTION_1_ID,
        tenant_id: SEED_TENANT_ID,
      }),
    );
    const student2 = await studentRepo.save(
      studentRepo.create({
        full_name: 'Student Two',
        registration_number: 'REG-002',
        roll_number: 1,
        class_section_id: SECTION_2_ID,
        tenant_id: SEED_TENANT_ID,
      }),
    );

    const enrollmentRepo = dataSource.getRepository(Enrollment);
    await enrollmentRepo.save(
      enrollmentRepo.create({
        student_id: student1.id,
        class_id: CLASS_1_ID,
        section_id: SECTION_1_ID,
        academic_year_id: ACADEMIC_YEAR_ID,
        enrollment_status: EnrollmentStatus.ACTIVE,
        tenant_id: SEED_TENANT_ID,
      }),
    );
    await enrollmentRepo.save(
      enrollmentRepo.create({
        student_id: student2.id,
        class_id: CLASS_2_ID,
        section_id: SECTION_2_ID,
        academic_year_id: ACADEMIC_YEAR_ID,
        enrollment_status: EnrollmentStatus.ACTIVE,
        tenant_id: SEED_TENANT_ID,
      }),
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('generates a plan across 2 classes into shared rooms, edits, reshuffles, publishes, and then locks the covered schedules', async () => {
    // 1. Generate: two subject-sittings from two different classes, sharing both rooms.
    const { plan, conflicts } = await service.generate(SEED_TENANT_ID, {
      name: 'Cross-class term exam seating',
      exam_schedule_ids: [SCHEDULE_1_ID, SCHEDULE_2_ID],
      room_ids: [ROOM_1_ID, ROOM_2_ID],
      seat_order_mode: SeatOrderMode.SEQUENTIAL,
    });
    expect(conflicts).toEqual([]);
    expect(plan.status).toBe(SeatPlanStatus.DRAFT);

    const allocationsAfterGenerate = await allocationRepo.find({
      where: { tenant_id: SEED_TENANT_ID, seat_plan_id: plan.id },
    });
    expect(allocationsAfterGenerate).toHaveLength(2);

    // 2. Manually edit one seat: move the schedule-1 allocation into room 2.
    const toMove = allocationsAfterGenerate.find((a) => a.exam_schedule_id === SCHEDULE_1_ID)!;
    const targetRoom = toMove.room_id === ROOM_1_ID ? ROOM_2_ID : ROOM_1_ID;
    const edited = await service.updateAllocation(SEED_TENANT_ID, plan.id, toMove.id, {
      room_id: targetRoom,
      seat_number: '5',
    });
    expect(edited.room_id).toBe(targetRoom);
    expect(edited.seat_number).toBe('5');

    // 3. Reshuffle one room: re-run seat assignment for room 1, must not
    // touch allocations that live in room 2.
    const beforeReshuffle = await allocationRepo.find({
      where: { tenant_id: SEED_TENANT_ID, seat_plan_id: plan.id },
    });
    const room2AllocationIdsBefore = beforeReshuffle
      .filter((a) => a.room_id === ROOM_2_ID)
      .map((a) => `${a.id}:${a.seat_number}`)
      .sort();

    await service.reshuffleRoom(SEED_TENANT_ID, plan.id, ROOM_1_ID);

    const afterReshuffle = await allocationRepo.find({
      where: { tenant_id: SEED_TENANT_ID, seat_plan_id: plan.id },
    });
    const room2AllocationIdsAfter = afterReshuffle
      .filter((a) => a.room_id === ROOM_2_ID)
      .map((a) => `${a.id}:${a.seat_number}`)
      .sort();
    expect(room2AllocationIdsAfter).toEqual(room2AllocationIdsBefore);

    // 4. Publish.
    const published = await service.publish(SEED_TENANT_ID, plan.id);
    expect(published.status).toBe(SeatPlanStatus.PUBLISHED);

    const planSchedules = await seatPlanScheduleRepo.find({
      where: { tenant_id: SEED_TENANT_ID, seat_plan_id: plan.id },
    });
    expect(planSchedules.map((s) => s.exam_schedule_id).sort()).toEqual(
      [SCHEDULE_1_ID, SCHEDULE_2_ID].sort(),
    );

    // 5. D6: the published plan's schedules are now locked against reuse —
    // a second generate() referencing either one is rejected.
    await expect(
      service.generate(SEED_TENANT_ID, {
        name: 'Reuse attempt',
        exam_schedule_ids: [SCHEDULE_1_ID],
        room_ids: [ROOM_1_ID],
        seat_order_mode: SeatOrderMode.SEQUENTIAL,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        details: expect.objectContaining({
          code: 'SCHEDULE_ALREADY_CLAIMED',
          exam_schedule_ids: [SCHEDULE_1_ID],
        }),
      }),
    });
  });
});
