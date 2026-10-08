import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DataSource, QueryFailedError } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';
import {
  LessonDeliveryReason,
  LessonDeliveryStatus,
  PeriodSlotKind,
  type StudyPlanExamMarker,
  type StudyPlanLesson,
} from '@biddaloy/shared';
import { School } from '../../schools/entities/school.entity';
import { User } from '../../users/entities/user.entity';
import { AcademicYear } from '../../academics/entities/academic-year.entity';
import { Class } from '../../academics/entities/class.entity';
import { ClassSection } from '../../academics/entities/class-section.entity';
import { Subject } from '../../academics/entities/subject.entity';
import { Teacher } from '../../academics/entities/teacher.entity';
import { AcademicTerm } from '../../calendar/entities/academic-term.entity';
import { Shift } from '../../routines/entities/shift.entity';
import { PeriodSlot } from '../../routines/entities/period-slot.entity';
import { StudyPlan } from './study-plan.entity';
import { LessonDelivery } from './lesson-delivery.entity';
import { StudyPlanTemplate } from './study-plan-template.entity';

/**
 * Integration tests for the [66.1.03] study-plan entities against the real,
 * migrated test database, so the migration-only unique index, CHECKs and
 * enum types (`1791500000000-StudyPlans.ts`) are exercised.
 */
describe('study plan entities (integration)', () => {
  let dataSource: DataSource;
  const TENANT_ID = SEED_TENANT_ID;

  let yearId: string;
  let termId: string;
  let sectionId: string;
  let subjectId: string;
  let teacherId: string;
  let userId: string;
  let slotId: string;

  const lessons: StudyPlanLesson[] = [
    { id: 'l1', title: 'Fractions', periods: 3, notes: 'Use the blocks' },
    { id: 'l2', title: 'Decimals', periods: 2, topic_id: '11111111-1111-4111-8111-111111111111' },
  ];
  const markers: StudyPlanExamMarker[] = [
    { exam_id: '22222222-2222-4222-8222-222222222222', up_to_lesson_id: 'l1' },
  ];

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    dataSource = module.get<DataSource>(getDataSourceToken());
    const schoolRepo = dataSource.getRepository(School);
    if (!(await schoolRepo.findOne({ where: { id: TENANT_ID } }))) {
      await schoolRepo.save({ id: TENANT_ID, name: 'Test School', slug: 'test-school' });
    }
  }, 60000);

  afterAll(async () => {
    if (dataSource) await dataSource.destroy();
  });

  beforeEach(async () => {
    // Children before parents.
    await dataSource.query('DELETE FROM lesson_deliveries');
    await dataSource.query('DELETE FROM study_plans');
    await dataSource.query('DELETE FROM study_plan_templates');
    await dataSource.query('DELETE FROM period_slots');
    await dataSource.query('DELETE FROM shifts');
    await dataSource.query('DELETE FROM academic_terms');
    await dataSource.query('DELETE FROM class_sections');
    await dataSource.query('DELETE FROM classes');
    await dataSource.query('DELETE FROM academic_years');
    await dataSource.query('DELETE FROM subjects');

    const year = await dataSource.getRepository(AcademicYear).save({
      name: '2026-sp',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      tenant_id: TENANT_ID,
    });
    const term = await dataSource.getRepository(AcademicTerm).save({
      tenant_id: TENANT_ID,
      academic_year_id: year.id,
      seq: 1,
      name: 'Term 1',
      start_date: '2026-01-01',
      end_date: '2026-06-30',
    });
    const klass = await dataSource.getRepository(Class).save({
      name: 'Class 6',
      academic_year_id: year.id,
      tenant_id: TENANT_ID,
    });
    const section = await dataSource.getRepository(ClassSection).save({
      section_name: 'A',
      class_id: klass.id,
      tenant_id: TENANT_ID,
    });
    const subject = await dataSource
      .getRepository(Subject)
      .save({ name_en: 'Mathematics', code: 'MATH', tenant_id: TENANT_ID });
    const user = await dataSource.getRepository(User).save({
      email: `sp-${Date.now()}-${Math.random()}@test.com`,
      full_name: 'Plan Teacher',
    });
    const teacher = await dataSource.getRepository(Teacher).save({
      user_id: user.id,
      employee_id: `EMP-SP-${Date.now()}`,
      tenant_id: TENANT_ID,
      designations: [],
    });
    const shift = await dataSource.getRepository(Shift).save({
      tenant_id: TENANT_ID,
      name: 'Morning-sp',
      day_starts_at: '08:00',
      day_ends_at: '13:00',
      sequence: 0,
    });
    const slot = await dataSource.getRepository(PeriodSlot).save({
      tenant_id: TENANT_ID,
      shift_id: shift.id,
      sequence: 1,
      kind: PeriodSlotKind.CLASS,
      name: 'P1',
      starts_at: '08:00',
      ends_at: '08:45',
    });
    yearId = year.id;
    termId = term.id;
    sectionId = section.id;
    subjectId = subject.id;
    teacherId = teacher.id;
    userId = user.id;
    slotId = slot.id;
  });

  const planBase = () => ({
    tenant_id: TENANT_ID,
    academic_year_id: yearId,
    section_id: sectionId,
    subject_id: subjectId,
  });

  it('saves and reloads a study plan with every column; lessons round-trip as objects', async () => {
    const repo = dataSource.getRepository(StudyPlan);
    const saved = await repo.save({
      ...planBase(),
      academic_term_id: termId,
      owner_override_teacher_id: teacherId,
      lessons,
      exam_markers: markers,
    });
    const found = await repo.findOneByOrFail({ id: saved.id });
    expect(found.academic_term_id).toBe(termId);
    expect(found.owner_override_teacher_id).toBe(teacherId);
    expect(found.lessons).toEqual(lessons);
    expect(found.exam_markers).toEqual(markers);
    expect(found.deleted_at).toBeNull();
  });

  it('defaults lessons and markers to an empty array', async () => {
    const saved = await dataSource.getRepository(StudyPlan).save(planBase());
    const found = await dataSource.getRepository(StudyPlan).findOneByOrFail({ id: saved.id });
    expect(found.lessons).toEqual([]);
    expect(found.exam_markers).toEqual([]);
  });

  it('a soft-deleted plan is skipped by a plain find', async () => {
    const repo = dataSource.getRepository(StudyPlan);
    const saved = await repo.save(planBase());
    await repo.softDelete(saved.id);
    expect(await repo.find({ where: { tenant_id: TENANT_ID } })).toHaveLength(0);
    expect(await repo.find({ where: { tenant_id: TENANT_ID }, withDeleted: true })).toHaveLength(1);
  });

  it('two live whole-year plans for one scope collide (NULLS NOT DISTINCT, migration index)', async () => {
    const repo = dataSource.getRepository(StudyPlan);
    await repo.save(planBase());
    await expect(repo.save(planBase())).rejects.toBeInstanceOf(QueryFailedError);
  });

  it('saves and reloads a delivery with every column; the slot unique index throws 23505', async () => {
    const repo = dataSource.getRepository(LessonDelivery);
    const saved = await repo.save({
      tenant_id: TENANT_ID,
      section_id: sectionId,
      subject_id: subjectId,
      date: '2026-03-02',
      period_slot_id: slotId,
      status: LessonDeliveryStatus.NOT_TAUGHT,
      reason: LessonDeliveryReason.ON_LEAVE,
      note: 'Teacher on leave',
      is_extra: false,
      auto: true,
      recorded_by_user_id: userId,
    });
    const found = await repo.findOneByOrFail({ id: saved.id });
    expect(found).toMatchObject({
      date: '2026-03-02',
      status: 'NOT_TAUGHT',
      reason: 'ON_LEAVE',
      note: 'Teacher on leave',
      is_extra: false,
      auto: true,
      recorded_by_user_id: userId,
    });

    // Same section + date + period again: the unique index rejects it.
    await expect(
      repo.save({
        tenant_id: TENANT_ID,
        section_id: sectionId,
        subject_id: subjectId,
        date: '2026-03-02',
        period_slot_id: slotId,
        status: LessonDeliveryStatus.TAUGHT,
      }),
    ).rejects.toMatchObject({ driverError: { code: '23505' } });
  });

  it('saves and reloads a template; lessons round-trip', async () => {
    const repo = dataSource.getRepository(StudyPlanTemplate);
    const templateLessons = [{ id: 'l1', title: 'Fractions', periods: 3 }];
    const saved = await repo.save({
      tenant_id: TENANT_ID,
      name: 'Class 6 Maths',
      class_grade: 6,
      subject_code: 'MATH',
      lessons: templateLessons,
    });
    const found = await repo.findOneByOrFail({ id: saved.id });
    expect(found).toMatchObject({ name: 'Class 6 Maths', class_grade: 6, subject_code: 'MATH' });
    expect(found.lessons).toEqual(templateLessons);
  });
});
