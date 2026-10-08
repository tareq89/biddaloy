import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';
import {
  PeriodSlotKind,
  RoutineState,
  TeacherAssignmentType,
  UserRole,
  SlotRecurrence,
  type StudyPlanLesson,
} from '@biddaloy/shared';
import { StudyPlansService, StudyPlanCaller } from './study-plans.service';
import { TeacherScopeService } from '../classes/teacher-scope.service';
import { AuditService } from '../audit/audit.service';
import { School } from '../schools/entities/school.entity';
import { User } from '../users/entities/user.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { ClassSubject } from '../academics/entities/class-subject.entity';
import { Subject } from '../academics/entities/subject.entity';
import { Teacher } from '../academics/entities/teacher.entity';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { AcademicTerm } from '../calendar/entities/academic-term.entity';
import { SyllabusTopic } from '../homework/entities/syllabus-topic.entity';
import { Exam } from '../exams/entities/exam.entity';
import { Shift } from '../routines/entities/shift.entity';
import { PeriodSlot } from '../routines/entities/period-slot.entity';
import { Routine } from '../routines/entities/routine.entity';
import { RoutineSlot } from '../routines/entities/routine-slot.entity';
import { RoutineSlotTeacher } from '../routines/entities/routine-slot-teacher.entity';
import { StudyPlan } from './entities/study-plan.entity';

/**
 * Real-DB tests for the study-plan service: the D6/D28 owner scope, create /
 * replace / copy rules, the read-time D32 filtering, `currentPlanFor`, and the
 * tenant fence. Years / classes / sections are made once; everything the
 * suite resets per test (subjects, terms, teachers, routines, plans) is made
 * in `beforeEach`.
 */
describe('StudyPlansService (integration)', () => {
  let service: StudyPlansService;
  let dataSource: DataSource;

  const TENANT = SEED_TENANT_ID;
  const TENANT_B = '00000000-0000-4000-8000-000000000096';

  let yearId: string;
  let class7: string;
  let class8: string;
  let sec7A: string;
  let sec7B: string;
  let sec8A: string;
  let termId: string;
  let math: string;
  let userT: string; // routine owner
  let teacherT: string;
  let userU: string; // not an owner
  let teacherU: string;
  let teacherTcs: string; // SUBJECT_TEACHER row only
  let adminUser: string;

  const admin = (): StudyPlanCaller => ({
    userId: adminUser,
    tenantId: TENANT,
    role: UserRole.ADMIN,
  });
  const teacher = (userId: string): StudyPlanCaller => ({
    userId,
    tenantId: TENANT,
    role: UserRole.TEACHER,
  });
  const lesson = (title: string, extra: Partial<StudyPlanLesson> = {}) => ({
    title,
    periods: 2,
    ...extra,
  });
  const code = (e: unknown) =>
    (e as { response?: { details?: { code?: string } } }).response?.details?.code;
  const status = (e: unknown) => (e as { status?: number }).status;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [
      StudyPlansService,
      TeacherScopeService,
      AuditService,
    ]);
    service = module.get(StudyPlansService);
    dataSource = module.get<DataSource>(getDataSourceToken());

    const schoolRepo = dataSource.getRepository(School);
    for (const id of [TENANT, TENANT_B]) {
      if (!(await schoolRepo.findOne({ where: { id } }))) {
        await schoolRepo.save({ id, name: id, slug: `school-${id.slice(-4)}` });
      }
    }
    const year = await dataSource.getRepository(AcademicYear).save({
      name: `SP Service ${Date.now()}`,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      tenant_id: TENANT,
    });
    yearId = year.id;
    const classRepo = dataSource.getRepository(Class);
    class7 = (
      await classRepo.save({
        name: 'SP 7',
        academic_year_id: yearId,
        tenant_id: TENANT,
        numeric_grade: 7,
      })
    ).id;
    class8 = (
      await classRepo.save({
        name: 'SP 8',
        academic_year_id: yearId,
        tenant_id: TENANT,
        numeric_grade: 8,
      })
    ).id;
    const secRepo = dataSource.getRepository(ClassSection);
    sec7A = (await secRepo.save({ section_name: 'A', class_id: class7, tenant_id: TENANT })).id;
    sec7B = (await secRepo.save({ section_name: 'B', class_id: class7, tenant_id: TENANT })).id;
    sec8A = (await secRepo.save({ section_name: 'A', class_id: class8, tenant_id: TENANT })).id;
    adminUser = (
      await dataSource
        .getRepository(User)
        .save({ email: `sp-admin-${Date.now()}@test.com`, full_name: 'SP Admin' })
    ).id;
  }, 60000);

  afterAll(async () => {
    if (dataSource) await dataSource.destroy();
  });

  async function makeTeacher(tag: string, tenantId = TENANT) {
    const user = await dataSource.getRepository(User).save({
      email: `sp-${tag}-${Date.now()}-${Math.random()}@test.com`,
      full_name: `SP ${tag}`,
    });
    const t = await dataSource.getRepository(Teacher).save({
      user_id: user.id,
      employee_id: `EMP-SP-${tag}-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      tenant_id: tenantId,
      designations: [],
    });
    return { userId: user.id, teacherId: t.id };
  }

  /** A routine with one slot for (section, subject); returns the slot id. */
  async function routineSlot(opts: {
    tenantId?: string;
    yearId?: string;
    state?: RoutineState;
    sectionId: string;
    subjectId: string;
    teacherIds: string[];
    validTo?: string | null;
  }) {
    const tenantId = opts.tenantId ?? TENANT;
    const shift = await dataSource.getRepository(Shift).save({
      tenant_id: tenantId,
      name: `Shift-${Math.random()}`,
      day_starts_at: '08:00',
      day_ends_at: '13:00',
      sequence: 0,
    });
    const period = await dataSource.getRepository(PeriodSlot).save({
      tenant_id: tenantId,
      shift_id: shift.id,
      sequence: 1,
      kind: PeriodSlotKind.CLASS,
      name: 'P1',
      starts_at: '08:00',
      ends_at: '08:45',
    });
    const routine = await dataSource.getRepository(Routine).save({
      tenant_id: tenantId,
      academic_year_id: opts.yearId ?? yearId,
      name: 'R',
      state: opts.state ?? RoutineState.PUBLISHED,
    });
    const slot = await dataSource.getRepository(RoutineSlot).save({
      tenant_id: tenantId,
      routine_id: routine.id,
      section_id: opts.sectionId,
      period_slot_id: period.id,
      weekday: 1,
      subject_id: opts.subjectId,
      recurrence: SlotRecurrence.WEEKLY,
      valid_from: opts.validTo ? '2025-01-01' : '2026-01-01',
      valid_to: opts.validTo ?? null,
    });
    for (const teacher_id of opts.teacherIds) {
      await dataSource
        .getRepository(RoutineSlotTeacher)
        .save({ tenant_id: tenantId, routine_slot_id: slot.id, teacher_id });
    }
    return slot.id;
  }

  beforeEach(async () => {
    const term = await dataSource.getRepository(AcademicTerm).save({
      tenant_id: TENANT,
      academic_year_id: yearId,
      seq: 1,
      name: 'Term 1',
      start_date: '2026-01-01',
      end_date: '2026-06-30',
    });
    termId = term.id;
    math = (
      await dataSource.getRepository(Subject).save({
        tenant_id: TENANT,
        name_en: 'Maths',
        code: `SPM${Math.floor(Math.random() * 1e6)}`,
      })
    ).id;
    const csRepo = dataSource.getRepository(ClassSubject);
    for (const classId of [class7, class8]) {
      await csRepo.save({
        tenant_id: TENANT,
        class_id: classId,
        subject_id: math,
        academic_year_id: yearId,
      });
    }
    const t = await makeTeacher('T');
    userT = t.userId;
    teacherT = t.teacherId;
    const u = await makeTeacher('U');
    userU = u.userId;
    teacherU = u.teacherId;
    teacherTcs = (await makeTeacher('TCS')).teacherId;
  });

  describe('ownerTeacherIds', () => {
    const owners = (sectionId = sec7A) => service.ownerTeacherIds(TENANT, sectionId, math, yearId);

    it('routine teachers win over a different TCS subject teacher', async () => {
      await routineSlot({ sectionId: sec7A, subjectId: math, teacherIds: [teacherT] });
      await dataSource.getRepository(TeacherClassSection).save({
        teacher_id: teacherTcs,
        section_id: sec7A,
        subject_id: math,
        tenant_id: TENANT,
        assignment_type: TeacherAssignmentType.SUBJECT_TEACHER,
      });
      expect(await owners()).toEqual([teacherT]);
    });

    it('returns both co-teachers of a slot', async () => {
      await routineSlot({ sectionId: sec7A, subjectId: math, teacherIds: [teacherT, teacherU] });
      expect((await owners()).sort()).toEqual([teacherT, teacherU].sort());
    });

    it('falls back to the TCS SUBJECT_TEACHER when there is no routine', async () => {
      await dataSource.getRepository(TeacherClassSection).save({
        teacher_id: teacherTcs,
        section_id: sec7A,
        subject_id: math,
        tenant_id: TENANT,
        assignment_type: TeacherAssignmentType.SUBJECT_TEACHER,
      });
      expect(await owners()).toEqual([teacherTcs]);
    });

    it('an override returns only the override', async () => {
      await routineSlot({ sectionId: sec7A, subjectId: math, teacherIds: [teacherT] });
      expect(await service.ownerTeacherIds(TENANT, sec7A, math, yearId, teacherU)).toEqual([
        teacherU,
      ]);
    });

    it('ignores a DRAFT routine', async () => {
      await routineSlot({
        sectionId: sec7A,
        subjectId: math,
        teacherIds: [teacherT],
        state: RoutineState.DRAFT,
      });
      expect(await owners()).toEqual([]);
    });

    it('ignores a slot that ended before the year started', async () => {
      await routineSlot({
        sectionId: sec7A,
        subjectId: math,
        teacherIds: [teacherT],
        validTo: '2025-12-31',
      });
      expect(await owners()).toEqual([]);
    });

    it("ignores another tenant's routine even with the same section and subject ids", async () => {
      const other = await makeTeacher('B', TENANT_B);
      await routineSlot({
        tenantId: TENANT_B,
        sectionId: sec7A,
        subjectId: math,
        teacherIds: [other.teacherId],
      });
      expect(await owners()).toEqual([]);
    });
  });

  describe('create', () => {
    const dto = (over: Record<string, unknown> = {}) => ({
      section_id: sec7A,
      subject_id: math,
      academic_term_id: termId as string | null,
      ...over,
    });

    beforeEach(async () => {
      await routineSlot({ sectionId: sec7A, subjectId: math, teacherIds: [teacherT] });
    });

    it('lets the owner and the admin create', async () => {
      const a = await service.create(dto(), TENANT, teacher(userT));
      expect(a.can_edit).toBe(true);
      expect(a.owners.map((o) => o.teacher_id)).toEqual([teacherT]);
      const b = await service.create(dto({ section_id: sec7B }), TENANT, admin());
      expect(b.id).toBeDefined();
    });

    it('refuses a teacher who does not own it (403)', async () => {
      const err = await service.create(dto(), TENANT, teacher(userU)).catch((e) => e);
      expect(status(err)).toBe(403);
      expect(code(err)).toBe('STUDY_PLAN_OUT_OF_SCOPE');
    });

    it('refuses a term from another year (400)', async () => {
      const otherYear = await dataSource.getRepository(AcademicYear).save({
        name: `SP Other ${Date.now()}`,
        start_date: '2027-01-01',
        end_date: '2027-12-31',
        tenant_id: TENANT,
      });
      const foreignTerm = await dataSource.getRepository(AcademicTerm).save({
        tenant_id: TENANT,
        academic_year_id: otherYear.id,
        seq: 1,
        name: 'Foreign',
        start_date: '2027-01-01',
        end_date: '2027-06-30',
      });
      const err = await service
        .create(dto({ academic_term_id: foreignTerm.id }), TENANT, admin())
        .catch((e) => e);
      expect(status(err)).toBe(400);
    });

    it('refuses a subject the class does not offer (400)', async () => {
      await dataSource.query('DELETE FROM class_subjects WHERE class_id = $1', [class7]);
      const err = await service.create(dto(), TENANT, admin()).catch((e) => e);
      expect(status(err)).toBe(400);
      expect(code(err)).toBe('STUDY_PLAN_SUBJECT_NOT_OFFERED');
    });

    it('a duplicate is 409 with the existing id, also for a whole-year plan', async () => {
      const first = await service.create(dto(), TENANT, admin());
      const err = await service.create(dto(), TENANT, admin()).catch((e) => e);
      expect(status(err)).toBe(409);
      expect(code(err)).toBe('STUDY_PLAN_EXISTS');
      expect(err.response.details.existing_id).toBe(first.id);

      const year = await service.create(dto({ academic_term_id: null }), TENANT, admin());
      const err2 = await service
        .create(dto({ academic_term_id: null }), TENANT, admin())
        .catch((e) => e);
      expect(status(err2)).toBe(409);
      expect(err2.response.details.existing_id).toBe(year.id);
    });

    it('after a soft delete the same plan can be created again', async () => {
      const first = await service.create(dto(), TENANT, admin());
      await service.remove(first.id, TENANT, admin());
      const row = await dataSource
        .getRepository(StudyPlan)
        .findOne({ where: { id: first.id }, withDeleted: true });
      expect(row?.deleted_at).not.toBeNull();
      const again = await service.create(dto(), TENANT, admin());
      expect(again.id).not.toBe(first.id);
    });
  });

  describe('replaceLessons', () => {
    let planId: string;
    beforeEach(async () => {
      planId = (
        await service.create(
          { section_id: sec7A, subject_id: math, academic_term_id: null },
          TENANT,
          admin(),
        )
      ).id;
    });
    const replace = (lessons: unknown[]) =>
      service.replaceLessons(planId, lessons as StudyPlanLesson[], TENANT, admin());

    it('enforces the limits', async () => {
      const bad: unknown[][] = [
        Array.from({ length: 401 }, (_, i) => lesson(`L${i}`)),
        [lesson('x', { periods: 0 })],
        [lesson('x', { periods: 21 })],
        [lesson('x'.repeat(201))],
      ];
      for (const lessons of bad) {
        expect(status(await replace(lessons).catch((e) => e))).toBe(400);
      }
    });

    it('assigns ids to lessons without one and keeps the order', async () => {
      const out = await replace([lesson(' First '), lesson('Second', { id: 'keep' })]);
      expect(out.lessons.map((l) => l.title)).toEqual(['First', 'Second']);
      expect(out.lessons[0].id).toMatch(/^[0-9a-f-]{36}$/);
      expect(out.lessons[1].id).toBe('keep');
    });

    it('rejects a topic of another class x subject (400)', async () => {
      const foreign = await dataSource.getRepository(SyllabusTopic).save({
        tenant_id: TENANT,
        class_id: class8,
        subject_id: math,
        name: 'Other class topic',
        sequence: 1,
      });
      const err = await replace([lesson('x', { topic_id: foreign.id })]).catch((e) => e);
      expect(status(err)).toBe(400);
      expect(code(err)).toBe('STUDY_PLAN_TOPIC_MISMATCH');
    });

    it('drops and reports a marker whose lesson was removed', async () => {
      await replace([lesson('One', { id: 'l1' }), lesson('Two', { id: 'l2' })]);
      const exam = await dataSource.getRepository(Exam).save({
        tenant_id: TENANT,
        academic_year_id: yearId,
        class_id: class7,
        name: 'Mid',
        kind: 'TERM',
      });
      await service.setExamMarkers(
        planId,
        [{ exam_id: exam.id, up_to_lesson_id: 'l2' }],
        TENANT,
        admin(),
      );
      const out = await replace([lesson('One', { id: 'l1' })]);
      expect(out.dropped_markers).toEqual([{ exam_id: exam.id, up_to_lesson_id: 'l2' }]);
      const row = await dataSource.getRepository(StudyPlan).findOneByOrFail({ id: planId });
      expect(row.exam_markers).toEqual([]);
    });
  });

  describe('DTO and read filtering', () => {
    it('list rows and detail carry section.class_id and academic_year_id (D44)', async () => {
      const created = await service.create(
        { section_id: sec7A, subject_id: math, academic_term_id: termId },
        TENANT,
        admin(),
      );
      const detail = await service.findOneForCaller(created.id, TENANT, admin());
      expect(detail.section.class_id).toBe(class7);
      expect(detail.academic_year_id).toBe(yearId);
      const list = await service.findAll({}, TENANT, admin());
      const row = list.data.find((r) => r.id === created.id)!;
      expect(row.section.class_id).toBe(class7);
      expect(row.academic_year_id).toBe(yearId);
    });

    it('hides a deleted topic link and a deleted exam marker but keeps them in the row (D32)', async () => {
      const topic = await dataSource.getRepository(SyllabusTopic).save({
        tenant_id: TENANT,
        class_id: class7,
        subject_id: math,
        name: 'T',
        sequence: 1,
      });
      const exam = await dataSource.getRepository(Exam).save({
        tenant_id: TENANT,
        academic_year_id: yearId,
        class_id: class7,
        name: 'Mid',
        kind: 'TERM',
      });
      const created = await service.create(
        {
          section_id: sec7A,
          subject_id: math,
          academic_term_id: null,
          lessons: [{ id: 'l1', title: 'One', periods: 1, topic_id: topic.id }],
        },
        TENANT,
        admin(),
      );
      await service.setExamMarkers(
        created.id,
        [{ exam_id: exam.id, up_to_lesson_id: 'l1' }],
        TENANT,
        admin(),
      );
      await dataSource.query('DELETE FROM syllabus_topics WHERE id = $1', [topic.id]);
      await dataSource.getRepository(Exam).softDelete({ id: exam.id });

      const read = await service.findOneForCaller(created.id, TENANT, admin());
      expect(read.lessons[0].topic_id).toBeUndefined();
      expect(read.exam_markers).toEqual([]);
      const row = await dataSource.getRepository(StudyPlan).findOneByOrFail({ id: created.id });
      expect(row.lessons[0].topic_id).toBe(topic.id);
      expect(row.exam_markers).toHaveLength(1);
    });
  });

  describe('copyToSection', () => {
    let planId: string;
    let topicId: string;
    let examId: string;
    beforeEach(async () => {
      await routineSlot({ sectionId: sec7A, subjectId: math, teacherIds: [teacherT] });
      topicId = (
        await dataSource.getRepository(SyllabusTopic).save({
          tenant_id: TENANT,
          class_id: class7,
          subject_id: math,
          name: 'Topic',
          sequence: 1,
        })
      ).id;
      examId = (
        await dataSource.getRepository(Exam).save({
          tenant_id: TENANT,
          academic_year_id: yearId,
          class_id: class7,
          name: 'Mid',
          kind: 'TERM',
        })
      ).id;
      planId = (
        await service.create(
          {
            section_id: sec7A,
            subject_id: math,
            academic_term_id: null,
            lessons: [{ id: 'l1', title: 'One', periods: 1, topic_id: topicId }],
          },
          TENANT,
          admin(),
        )
      ).id;
      await service.setExamMarkers(
        planId,
        [{ exam_id: examId, up_to_lesson_id: 'l1' }],
        TENANT,
        admin(),
      );
    });

    it('same class keeps topics and markers, with new lesson ids', async () => {
      const copy = await service.copyToSection(planId, sec7B, TENANT, admin());
      expect(copy.id).not.toBe(planId);
      expect(copy.lessons[0].topic_id).toBe(topicId);
      expect(copy.lessons[0].id).not.toBe('l1');
      expect(copy.exam_markers).toEqual([
        expect.objectContaining({ exam_id: examId, up_to_lesson_id: copy.lessons[0].id }),
      ]);
    });

    it('another class drops topics and markers', async () => {
      const copy = await service.copyToSection(planId, sec8A, TENANT, admin());
      expect(copy.lessons[0].topic_id).toBeUndefined();
      expect(copy.exam_markers).toEqual([]);
    });

    it('a caller who does not own the target gets 403', async () => {
      // T owns 7-A only; 7-B has no routine owner for T.
      const err = await service
        .copyToSection(planId, sec7B, TENANT, teacher(userT))
        .catch((e) => e);
      expect(status(err)).toBe(403);
    });

    it('a target that already has a plan gets 409', async () => {
      await service.copyToSection(planId, sec7B, TENANT, admin());
      const err = await service.copyToSection(planId, sec7B, TENANT, admin()).catch((e) => e);
      expect(status(err)).toBe(409);
      expect(code(err)).toBe('STUDY_PLAN_EXISTS');
    });
  });

  describe('currentPlanFor', () => {
    it('returns the term plan inside the term, the whole-year plan outside, null when none', async () => {
      expect(await service.currentPlanFor(TENANT, sec7A, math, '2026-03-01')).toBeNull();
      const whole = await service.create(
        { section_id: sec7A, subject_id: math, academic_term_id: null },
        TENANT,
        admin(),
      );
      expect((await service.currentPlanFor(TENANT, sec7A, math, '2026-03-01'))?.id).toBe(whole.id);
      const term = await service.create(
        { section_id: sec7A, subject_id: math, academic_term_id: termId },
        TENANT,
        admin(),
      );
      expect((await service.currentPlanFor(TENANT, sec7A, math, '2026-03-01'))?.id).toBe(term.id);
      // After the term ends, the whole-year plan applies again.
      expect((await service.currentPlanFor(TENANT, sec7A, math, '2026-09-01'))?.id).toBe(whole.id);
      // Outside the year: nothing.
      expect(await service.currentPlanFor(TENANT, sec7A, math, '2030-01-01')).toBeNull();
    });
  });

  describe('tenant isolation and audit', () => {
    it("another tenant's caller gets 404 on read, edit and delete", async () => {
      const created = await service.create(
        { section_id: sec7A, subject_id: math, academic_term_id: null },
        TENANT,
        admin(),
      );
      const other: StudyPlanCaller = {
        userId: adminUser,
        tenantId: TENANT_B,
        role: UserRole.ADMIN,
      };
      expect(
        status(await service.findOneForCaller(created.id, TENANT_B, other).catch((e) => e)),
      ).toBe(404);
      expect(
        status(await service.replaceLessons(created.id, [], TENANT_B, other).catch((e) => e)),
      ).toBe(404);
      expect(status(await service.remove(created.id, TENANT_B, other).catch((e) => e))).toBe(404);
      const list = await service.findAll({}, TENANT_B, other);
      expect(list.data.find((r) => r.id === created.id)).toBeUndefined();
      const row = await dataSource.getRepository(StudyPlan).findOneByOrFail({ id: created.id });
      expect(row.deleted_at).toBeNull();
    });

    it('every write leaves one StudyPlan audit row', async () => {
      const count = async (id: string) =>
        Number(
          (
            await dataSource.query(
              `SELECT COUNT(*)::int AS n FROM audit_logs WHERE entity_type = 'StudyPlan' AND entity_id = $1`,
              [id],
            )
          )[0].n,
        );
      const p = await service.create(
        { section_id: sec7A, subject_id: math, academic_term_id: null },
        TENANT,
        admin(),
      );
      expect(await count(p.id)).toBe(1);
      await service.replaceLessons(p.id, [lesson('One', { id: 'l1' })], TENANT, admin());
      expect(await count(p.id)).toBe(2);
      await service.setExamMarkers(p.id, [], TENANT, admin());
      expect(await count(p.id)).toBe(3);
      await service.setOwnerOverride(p.id, teacherU, TENANT, admin());
      expect(await count(p.id)).toBe(4);
      await service.remove(p.id, TENANT, admin());
      expect(await count(p.id)).toBe(5);
    });
  });
});
