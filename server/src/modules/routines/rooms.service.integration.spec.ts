import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { RoomsService } from './rooms.service';
import { Room } from './entities/room.entity';
import { School } from '../schools/entities/school.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Subject } from '../academics/entities/subject.entity';
import { Student } from '../students/entities/student.entity';
import { Exam } from '../exams/entities/exam.entity';
import { ExamSchedule } from '../exams/entities/exam-schedule.entity';
import { SeatPlan } from '../seat-plans/entities/seat-plan.entity';
import { SeatAllocation } from '../seat-plans/entities/seat-allocation.entity';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';
import { ExamKind, SeatOrderMode } from '@biddaloy/shared';

/**
 * [2627] RoomsService.remove against a real Postgres: a room that a seat plan
 * still uses cannot be deleted (it would render a null room on the plan).
 */
describe('RoomsService (integration) [2627]', () => {
  let service: RoomsService;
  let dataSource: DataSource;

  const TENANT_ID = SEED_TENANT_ID;
  const OTHER_TENANT = '00000000-0000-4000-8000-000000000099';

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [RoomsService], [], {
      synchronize: true,
      dropSchema: true,
    });
    service = module.get(RoomsService);
    dataSource = module.get<DataSource>(getDataSourceToken());

    const schoolRepo = dataSource.getRepository(School);
    for (const [id, slug] of [
      [TENANT_ID, 'test-school'],
      [OTHER_TENANT, 'other-school'],
    ]) {
      if (!(await schoolRepo.findOne({ where: { id } }))) {
        await schoolRepo.save({ id, name: slug, slug });
      }
    }
  }, 60000);

  afterAll(async () => {
    if (dataSource) await dataSource.destroy();
  });

  beforeEach(async () => {
    for (const t of [
      'seat_allocations',
      'seat_plans',
      'exam_schedules',
      'exams',
      'students',
      'rooms',
      'subjects',
      'class_sections',
      'classes',
      'academic_years',
    ]) {
      await dataSource.query(`DELETE FROM ${t}`);
    }
  });

  /** One allocation of `roomId` on a new seat plan, built through the real FKs. */
  async function allocate(roomId: string, tenantId: string) {
    const year = await dataSource.getRepository(AcademicYear).save({
      name: 'Y',
      start_date: new Date('2026-01-01'),
      end_date: new Date('2026-12-31'),
      tenant_id: tenantId,
    });
    const klass = await dataSource
      .getRepository(Class)
      .save({ name: 'Class 1', academic_year_id: year.id, tenant_id: tenantId });
    const section = await dataSource
      .getRepository(ClassSection)
      .save({ class_id: klass.id, section_name: 'A', tenant_id: tenantId });
    const student = await dataSource.getRepository(Student).save({
      full_name: 'Seat Student',
      registration_number: `REG-${tenantId.slice(-2)}`,
      roll_number: 1,
      class_section_id: section.id,
      tenant_id: tenantId,
    });
    const subject = await dataSource
      .getRepository(Subject)
      .save({ name_en: 'Maths', code: 'MATH', tenant_id: tenantId });
    const exam = await dataSource.getRepository(Exam).save({
      tenant_id: tenantId,
      academic_year_id: year.id,
      class_id: klass.id,
      name: 'Seat exam',
      kind: ExamKind.TERM,
    });
    const schedule = await dataSource.getRepository(ExamSchedule).save({
      tenant_id: tenantId,
      exam_id: exam.id,
      subject_id: subject.id,
      date: '2026-03-01',
      starts_at: '10:00',
      ends_at: '12:00',
    });
    const plan = await dataSource.getRepository(SeatPlan).save({
      tenant_id: tenantId,
      name: 'Plan',
      seat_order_mode: SeatOrderMode.SEQUENTIAL,
    });
    await dataSource.getRepository(SeatAllocation).save({
      tenant_id: tenantId,
      seat_plan_id: plan.id,
      exam_schedule_id: schedule.id,
      student_id: student.id,
      room_id: roomId,
      seat_number: '1',
    });
    return plan;
  }

  it('refuses to delete a room used by a live seat plan (409 ROOM_IN_USE)', async () => {
    const room = await service.create({ room_no: 'R1' } as any, TENANT_ID);
    await allocate(room.id, TENANT_ID);

    await expect(service.remove(room.id, TENANT_ID)).rejects.toMatchObject({
      response: { details: { code: 'ROOM_IN_USE', seat_allocations_count: 1 } },
    });
    await expect(service.findOne(room.id, TENANT_ID)).resolves.toBeDefined();
  });

  it('deletes the room once the seat plan is soft-deleted', async () => {
    const room = await service.create({ room_no: 'R1' } as any, TENANT_ID);
    const plan = await allocate(room.id, TENANT_ID);
    await dataSource.getRepository(SeatPlan).softDelete({ id: plan.id });

    await service.remove(room.id, TENANT_ID);

    await expect(service.findOne(room.id, TENANT_ID)).rejects.toThrow(NotFoundException);
  });

  it("another tenant's allocation does not block the delete", async () => {
    const mine = await service.create({ room_no: 'R1' } as any, TENANT_ID);
    const theirs = await service.create({ room_no: 'R1' } as any, OTHER_TENANT);
    await allocate(theirs.id, OTHER_TENANT);

    await service.remove(mine.id, TENANT_ID);

    await expect(service.findOne(mine.id, TENANT_ID)).rejects.toThrow(NotFoundException);
    expect(await dataSource.getRepository(Room).count({ where: { id: theirs.id } })).toBe(1);
  });
});
