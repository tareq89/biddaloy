import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';
import {
  PeriodSlotKind,
  RoutineState,
  SlotRecurrence,
  UserRole,
  type StudyPlanLesson,
} from '@biddaloy/shared';
import { StudyPlanTemplatesService } from './study-plan-templates.service';
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
import { Shift } from '../routines/entities/shift.entity';
import { PeriodSlot } from '../routines/entities/period-slot.entity';
import { Routine } from '../routines/entities/routine.entity';
import { RoutineSlot } from '../routines/entities/routine-slot.entity';
import { RoutineSlotTeacher } from '../routines/entities/routine-slot-teacher.entity';
import { StudyPlanTemplate } from './entities/study-plan-template.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';

/**
 * Real-DB tests for the study-plan template library (66.2.06): CRUD and the
 * name rule, from-plan, copy (owner scope comes from StudyPlansService),
 * list filters and the tenant fence.
 */
describe('StudyPlanTemplatesService (integration)', () => {
  let service: StudyPlanTemplatesService;
  let plans: StudyPlansService;
  let dataSource: DataSource;

  const TENANT = SEED_TENANT_ID;
  const TENANT_B = '00000000-0000-4000-8000-000000000097';

  let yearId: string;
  let class7: string;
  let class8: string;
  let classNoGrade: string;
  let sec7A: string;
  let sec8A: string;
  let secNoGrade: string;
  let math: string;
  let mathCode: string;
  let userT: string;
  let teacherT: string;
  let userU: string;
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
  const lessons = (n = 2) =>
    Array.from({ length: n }, (_, i) => ({ title: `Lesson ${i + 1}`, periods: 2 }));
  const code = (e: unknown) =>
    (e as { response?: { details?: { code?: string } } }).response?.details?.code;
  const status = (e: unknown) => (e as { status?: number }).status;
  const tpl = (name: string, over: Record<string, unknown> = {}) => ({
    name,
    class_grade: 7,
    subject_code: mathCode,
    lessons: lessons(),
    ...over,
  });
  async function fails(p: Promise<unknown>) {
    try {
      await p;
    } catch (e) {
      return e;
    }
    throw new Error('expected rejection');
  }

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [
      StudyPlanTemplatesService,
      StudyPlansService,
      TeacherScopeService,
      AuditService,
    ]);
    service = module.get(StudyPlanTemplatesService);
    plans = module.get(StudyPlansService);
    dataSource = module.get<DataSource>(getDataSourceToken());

    const schoolRepo = dataSource.getRepository(School);
    for (const id of [TENANT, TENANT_B]) {
      if (!(await schoolRepo.findOne({ where: { id } }))) {
        await schoolRepo.save({ id, name: id, slug: `school-${id.slice(-4)}` });
      }
    }
    yearId = (
      await dataSource.getRepository(AcademicYear).save({
        name: `SPT ${Date.now()}`,
        start_date: '2026-01-01',
        end_date: '2026-12-31',
        tenant_id: TENANT,
      })
    ).id;
    const classRepo = dataSource.getRepository(Class);
    class7 = (
      await classRepo.save({
        name: 'SPT 7',
        academic_year_id: yearId,
        tenant_id: TENANT,
        numeric_grade: 7,
      })
    ).id;
    class8 = (
      await classRepo.save({
        name: 'SPT 8',
        academic_year_id: yearId,
        tenant_id: TENANT,
        numeric_grade: 8,
      })
    ).id;
    classNoGrade = (
      await classRepo.save({ name: 'SPT Nursery', academic_year_id: yearId, tenant_id: TENANT })
    ).id;
    const secRepo = dataSource.getRepository(ClassSection);
    sec7A = (await secRepo.save({ section_name: 'A', class_id: class7, tenant_id: TENANT })).id;
    sec8A = (await secRepo.save({ section_name: 'A', class_id: class8, tenant_id: TENANT })).id;
    secNoGrade = (
      await secRepo.save({ section_name: 'A', class_id: classNoGrade, tenant_id: TENANT })
    ).id;
    adminUser = (
      await dataSource
        .getRepository(User)
        .save({ email: `spt-admin-${Date.now()}@test.com`, full_name: 'SPT Admin' })
    ).id;
  }, 60000);

  afterAll(async () => {
    if (dataSource) await dataSource.destroy();
  });

  async function makeTeacher(tag: string) {
    const user = await dataSource.getRepository(User).save({
      email: `spt-${tag}-${Date.now()}-${Math.random()}@test.com`,
      full_name: `SPT ${tag}`,
    });
    const t = await dataSource.getRepository(Teacher).save({
      user_id: user.id,
      employee_id: `EMP-SPT-${tag}-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      tenant_id: TENANT,
      designations: [],
    });
    return { userId: user.id, teacherId: t.id };
  }

  /** T teaches `subjectId` in `sectionId` (published routine slot) → T owns the plan. */
  async function routineSlot(
    sectionId: string,
    subjectId: string,
    teacherId: string,
    routineId?: string,
  ): Promise<string> {
    const shift = await dataSource.getRepository(Shift).save({
      tenant_id: TENANT,
      name: `Shift-${Math.random()}`,
      day_starts_at: '08:00',
      day_ends_at: '13:00',
      sequence: 0,
    });
    const period = await dataSource.getRepository(PeriodSlot).save({
      tenant_id: TENANT,
      shift_id: shift.id,
      sequence: 1,
      kind: PeriodSlotKind.CLASS,
      name: 'P1',
      starts_at: '08:00',
      ends_at: '08:45',
    });
    // One routine per tenant+year: later slots reuse the first one.
    routineId ??= (
      await dataSource.getRepository(Routine).save({
        tenant_id: TENANT,
        academic_year_id: yearId,
        name: 'R',
        state: RoutineState.PUBLISHED,
      })
    ).id;
    const slot = await dataSource.getRepository(RoutineSlot).save({
      tenant_id: TENANT,
      routine_id: routineId,
      section_id: sectionId,
      period_slot_id: period.id,
      weekday: 1,
      subject_id: subjectId,
      recurrence: SlotRecurrence.WEEKLY,
      valid_from: '2026-01-01',
      valid_to: null,
    });
    await dataSource
      .getRepository(RoutineSlotTeacher)
      .save({ tenant_id: TENANT, routine_slot_id: slot.id, teacher_id: teacherId });
    return routineId;
  }

  beforeEach(async () => {
    mathCode = `SPT${Math.floor(Math.random() * 1e8)}`;
    math = (
      await dataSource
        .getRepository(Subject)
        .save({ tenant_id: TENANT, name_en: 'Maths', code: mathCode })
    ).id;
    for (const classId of [class7, class8, classNoGrade]) {
      await dataSource.getRepository(ClassSubject).save({
        tenant_id: TENANT,
        class_id: classId,
        subject_id: math,
        academic_year_id: yearId,
      });
    }
    const t = await makeTeacher('T');
    userT = t.userId;
    teacherT = t.teacherId;
    userU = (await makeTeacher('U')).userId;
    const routineId = await routineSlot(sec7A, math, teacherT);
    await routineSlot(secNoGrade, math, teacherT, routineId);
  });

  describe('CRUD', () => {
    it('create / get / patch / delete round trip, with audit rows', async () => {
      const created = await service.create(tpl('Maths 7'), TENANT, adminUser);
      expect(created).toMatchObject({
        name: 'Maths 7',
        class_grade: 7,
        subject_code: mathCode,
        subject_name: 'Maths',
        lesson_count: 2,
        total_periods: 4,
      });
      expect(created.lessons).toHaveLength(2);
      expect(created.lessons[0].id).toBeTruthy();

      const got = await service.get(created.id, TENANT);
      expect(got.name).toBe('Maths 7');

      const patched = await service.update(
        created.id,
        { name: 'Maths 7 v2', class_grade: 8, lessons: lessons(3) },
        TENANT,
        adminUser,
      );
      expect(patched).toMatchObject({ name: 'Maths 7 v2', class_grade: 8, lesson_count: 3 });

      await service.remove(created.id, TENANT, adminUser);
      expect(status(await fails(service.get(created.id, TENANT)))).toBe(404);

      // Soft delete: the row is still there with deleted_at set.
      const row = await dataSource
        .getRepository(StudyPlanTemplate)
        .findOne({ where: { id: created.id }, withDeleted: true });
      expect(row?.deleted_at).not.toBeNull();

      const audits = await dataSource
        .getRepository(AuditLog)
        .find({ where: { entity_type: 'StudyPlanTemplate', entity_id: created.id } });
      expect(audits.map((a) => a.action).sort()).toEqual(['CREATE', 'DELETE', 'UPDATE']);
    });

    it('a duplicate live name is 409, after delete it is free, another tenant may reuse it', async () => {
      const first = await service.create(tpl('Same name'), TENANT, adminUser);
      const err = await fails(service.create(tpl('Same name'), TENANT, adminUser));
      expect(status(err)).toBe(409);
      expect(code(err)).toBe('STUDY_PLAN_TEMPLATE_NAME_TAKEN');

      // Renaming onto a taken name is also 409.
      const other = await service.create(tpl('Other'), TENANT, adminUser);
      expect(status(await fails(service.update(other.id, { name: 'Same name' }, TENANT)))).toBe(
        409,
      );

      await service.remove(first.id, TENANT, adminUser);
      await service.create(tpl('Same name'), TENANT, adminUser);
      await service.create(tpl('Same name'), TENANT_B, adminUser);
    });

    it('a topic_id on a lesson is 400', async () => {
      const bad = [{ title: 'L', periods: 1, topic_id: '00000000-0000-4000-8000-000000000001' }];
      const err = await fails(service.create(tpl('Topic', { lessons: bad }), TENANT, adminUser));
      expect(status(err)).toBe(400);
      expect(code(err)).toBe('STUDY_PLAN_LESSON_INVALID');
    });

    it('lesson limits apply: periods 1-20, title required, unique ids', async () => {
      const cases = [
        [{ title: 'L', periods: 0 }],
        [{ title: 'L', periods: 21 }],
        [{ title: '  ', periods: 2 }],
        [
          { id: 'x', title: 'A', periods: 1 },
          { id: 'x', title: 'B', periods: 1 },
        ],
      ];
      for (const [i, bad] of cases.entries()) {
        const err = await fails(service.create(tpl(`Bad ${i}`, { lessons: bad }), TENANT));
        expect(status(err)).toBe(400);
        expect(code(err)).toBe('STUDY_PLAN_LESSON_INVALID');
      }
    });
  });

  describe('from-plan', () => {
    async function planWithTopic(): Promise<string> {
      const created = await plans.create(
        {
          section_id: sec7A,
          subject_id: math,
          academic_term_id: null,
          lessons: [{ title: 'A', periods: 3, notes: 'n' }],
        },
        TENANT,
        admin(),
      );
      return created.id;
    }

    it('takes grade and code from the plan, drops topic links, names it by default', async () => {
      const planId = await planWithTopic();
      // A stored lesson with a topic link (as an older/edited plan might have).
      await dataSource.query(
        `UPDATE study_plans SET lessons = jsonb_set(lessons, '{0,topic_id}', '"00000000-0000-4000-8000-0000000000bb"') WHERE id = $1`,
        [planId],
      );
      const t = await service.fromPlan(planId, undefined, TENANT, admin());
      expect(t).toMatchObject({ class_grade: 7, subject_code: mathCode, lesson_count: 1 });
      expect(t.name).toContain('SPT 7');
      expect(t.name).toContain('Maths');
      expect(JSON.stringify(t.lessons)).not.toContain('topic_id');
      expect(t.lessons[0]).toMatchObject({ title: 'A', periods: 3, notes: 'n' });
    });

    it('a plan the caller cannot read is 403', async () => {
      const planId = await planWithTopic();
      const err = await fails(service.fromPlan(planId, 'X', TENANT, teacher(userU)));
      expect(status(err)).toBe(403);
    });

    it('a class with no numeric grade is 400 STUDY_PLAN_TEMPLATE_NO_GRADE', async () => {
      const created = await plans.create(
        { section_id: secNoGrade, subject_id: math, academic_term_id: null },
        TENANT,
        admin(),
      );
      const err = await fails(service.fromPlan(created.id, 'X', TENANT, admin()));
      expect(status(err)).toBe(400);
      expect(code(err)).toBe('STUDY_PLAN_TEMPLATE_NO_GRADE');
    });
  });

  describe('copy', () => {
    it('makes the owner a plan with fresh lesson ids, no topic, and no link back', async () => {
      const t = await service.create(tpl('Copy me'), TENANT, adminUser);
      const plan = await service.copy(
        t.id,
        { section_id: sec7A, subject_id: math, academic_term_id: null },
        TENANT,
        teacher(userT),
      );
      expect(plan.lessons).toHaveLength(2);
      const templateIds = t.lessons.map((l) => l.id);
      for (const l of plan.lessons as StudyPlanLesson[]) {
        expect(templateIds).not.toContain(l.id);
        expect(l.topic_id).toBeUndefined();
      }
      expect(plan.lessons.map((l) => l.title)).toEqual(t.lessons.map((l) => l.title));

      // Editing the template later does not touch the plan.
      await service.update(t.id, { lessons: lessons(5) }, TENANT, adminUser);
      const again = await plans.findOneForCaller(plan.id, TENANT, admin());
      expect(again.lessons).toHaveLength(2);
      // And the copy left the template as it was.
      expect((await service.get(t.id, TENANT)).lesson_count).toBe(5);
    });

    it('the template is unchanged by a copy', async () => {
      const t = await service.create(tpl('Stay put'), TENANT, adminUser);
      await service.copy(
        t.id,
        { section_id: sec7A, subject_id: math, academic_term_id: null },
        TENANT,
        admin(),
      );
      expect(await service.get(t.id, TENANT)).toMatchObject({ lesson_count: 2, name: 'Stay put' });
      expect((await service.get(t.id, TENANT)).lessons.map((l) => l.id)).toEqual(
        t.lessons.map((l) => l.id),
      );
    });

    it('a teacher who does not own the scope gets 403', async () => {
      const t = await service.create(tpl('No'), TENANT, adminUser);
      const err = await fails(
        service.copy(
          t.id,
          { section_id: sec7A, subject_id: math, academic_term_id: null },
          TENANT,
          teacher(userU),
        ),
      );
      expect(status(err)).toBe(403);
    });

    it('a scope that already has a plan is 409 with existing_id', async () => {
      const t = await service.create(tpl('Twice'), TENANT, adminUser);
      const first = await service.copy(
        t.id,
        { section_id: sec7A, subject_id: math, academic_term_id: null },
        TENANT,
        admin(),
      );
      const err = await fails(
        service.copy(
          t.id,
          { section_id: sec7A, subject_id: math, academic_term_id: null },
          TENANT,
          admin(),
        ),
      );
      expect(status(err)).toBe(409);
      expect(
        (err as { response?: { details?: { existing_id?: string } } }).response?.details
          ?.existing_id,
      ).toBe(first.id);
    });

    it('a Class 7 template can be copied into Class 8 (grade is a guide only)', async () => {
      const t = await service.create(tpl('Seven'), TENANT, adminUser);
      const plan = await service.copy(
        t.id,
        { section_id: sec8A, subject_id: math, academic_term_id: null },
        TENANT,
        admin(),
      );
      expect(plan.section.class_id).toBe(class8);
    });

    it('a deleted or foreign template is 404', async () => {
      const t = await service.create(tpl('Gone'), TENANT, adminUser);
      const dto = { section_id: sec7A, subject_id: math, academic_term_id: null };
      await service.remove(t.id, TENANT, adminUser);
      expect(status(await fails(service.copy(t.id, dto, TENANT, admin())))).toBe(404);
      const b = await service.create(tpl('B only'), TENANT_B, adminUser);
      expect(status(await fails(service.copy(b.id, dto, TENANT, admin())))).toBe(404);
    });
  });

  describe('list', () => {
    it('filters by grade, code and name; counts lessons and periods; hides deleted and other tenants', async () => {
      const a = await service.create(tpl('Alpha 7', { lessons: lessons(3) }), TENANT, adminUser);
      await service.create(tpl('Beta 8', { class_grade: 8 }), TENANT, adminUser);
      await service.create(tpl('Gamma other', { subject_code: 'ZZ-OTHER' }), TENANT, adminUser);
      const gone = await service.create(tpl('Deleted 7'), TENANT, adminUser);
      await service.remove(gone.id, TENANT, adminUser);
      await service.create(tpl('Tenant B 7'), TENANT_B, adminUser);

      const g7 = await service.list({ class_grade: 7, subject_code: mathCode }, TENANT);
      expect(g7.data.map((d) => d.name)).toEqual(['Alpha 7']);
      expect(g7.data[0]).toMatchObject({
        id: a.id,
        lesson_count: 3,
        total_periods: 6,
        subject_name: 'Maths',
      });
      expect((await service.list({ class_grade: 8 }, TENANT)).data.map((d) => d.name)).toEqual([
        'Beta 8',
      ]);
      const other = await service.list({ subject_code: 'ZZ-OTHER' }, TENANT);
      expect(other.data[0].subject_name).toBeNull();

      const all = (await service.list({}, TENANT)).data.map((d) => d.name);
      expect(all).not.toContain('Deleted 7');
      expect(all).not.toContain('Tenant B 7');

      // q is a case-insensitive name match; % and _ are literal.
      expect((await service.list({ q: 'ALPHA' }, TENANT)).data).toHaveLength(1);
      expect((await service.list({ q: '%' }, TENANT)).data).toHaveLength(0);
    });
  });
});
