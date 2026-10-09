import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import type { TestingModule } from '@nestjs/testing';
import {
  ExamKind,
  LessonDeliveryReason,
  LessonDeliveryStatus,
  PeriodSlotKind,
} from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { School } from '../../../schools/entities/school.entity';
import { User } from '../../../users/entities/user.entity';
import { AcademicYear } from '../../../academics/entities/academic-year.entity';
import { Class } from '../../../academics/entities/class.entity';
import { ClassSection } from '../../../academics/entities/class-section.entity';
import { Subject } from '../../../academics/entities/subject.entity';
import { Teacher } from '../../../academics/entities/teacher.entity';
import { AcademicTerm } from '../../../calendar/entities/academic-term.entity';
import { Shift } from '../../../routines/entities/shift.entity';
import { PeriodSlot } from '../../../routines/entities/period-slot.entity';
import { Exam } from '../../../exams/entities/exam.entity';
import { SyllabusTopic } from '../../../homework/entities/syllabus-topic.entity';
import { StudyPlan } from '../../../study-plans/entities/study-plan.entity';
import { LessonDelivery } from '../../../study-plans/entities/lesson-delivery.entity';
import { StudyPlanTemplate } from '../../../study-plans/entities/study-plan-template.entity';
import { toCell } from '../../codec/cell-format';
import type { ExportContext, ImportContext, TabSpec } from '../../codec/tab-spec';
import { sectionsTab } from './sections.tab';
import { periodSlotsTab } from '../routines/period-slots.tab';
import { studyPlansTab } from './study-plans.tab';
import { lessonDeliveriesTab } from './lesson-deliveries.tab';
import { studyPlanTemplatesTab } from './study-plan-templates.tab';

/**
 * [66.1.03] Round trip (export -> wipe -> restore -> compare) for the three
 * study-plan tabs against real Postgres. The wipe is a raw delete, so restore
 * recreates every row from cells alone, the same path a workbook restore takes.
 */
describe('study plan tabs (round trip, integration)', () => {
  let module: TestingModule;
  let ds: DataSource;

  const TENANT = '44444444-4444-4444-8444-444444444444';
  const OTHER = '55555555-5555-4555-8555-555555555555';
  const SUFFIX = 'sp-tabs';

  beforeAll(async () => {
    module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get(DataSource);
  });
  afterAll(async () => {
    await module?.close();
  });

  async function wipe() {
    for (const t of [
      'lesson_deliveries',
      'study_plans',
      'study_plan_templates',
      'syllabus_topics',
      'exams',
      'period_slots',
      'shifts',
      'academic_terms',
      'teachers',
      'class_sections',
      'classes',
      'academic_years',
      'subjects',
    ]) {
      await ds.query(`DELETE FROM ${t} WHERE tenant_id IN ($1, $2)`, [TENANT, OTHER]);
    }
    await ds.query(`DELETE FROM users WHERE email LIKE $1`, [`%@${SUFFIX}.test`]);
    await ds.query(`DELETE FROM schools WHERE id IN ($1, $2)`, [TENANT, OTHER]);
  }

  beforeEach(async () => {
    await wipe();
    await ds.getRepository(School).save([
      { id: TENANT, name: 'Plan School', slug: 'plan-school-tabs' },
      { id: OTHER, name: 'Other School', slug: 'other-school-tabs' },
    ]);
  });

  /** One tenant's academic world plus its study-plan rows. */
  async function seed(tenantId: string, tag: string) {
    const email = `${tag}@${SUFFIX}.test`;
    const user = await ds.getRepository(User).save({ email, full_name: `User ${tag}` });
    const teacher = await ds.getRepository(Teacher).save({
      user_id: user.id,
      employee_id: `EMP-${tag}`,
      tenant_id: tenantId,
      designations: [],
    });
    const year = await ds.getRepository(AcademicYear).save({
      name: `2026-${tag}`,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      tenant_id: tenantId,
    });
    const term1 = await ds.getRepository(AcademicTerm).save({
      tenant_id: tenantId,
      academic_year_id: year.id,
      seq: 1,
      name: 'Term 1',
      start_date: '2026-01-01',
      end_date: '2026-06-30',
    });
    const klass = await ds
      .getRepository(Class)
      .save({ name: `Six-${tag}`, academic_year_id: year.id, tenant_id: tenantId });
    const section = await ds
      .getRepository(ClassSection)
      .save({ section_name: 'A', class_id: klass.id, tenant_id: tenantId });
    const math = await ds
      .getRepository(Subject)
      .save({ name_en: 'Maths', code: `M-${tag}`, tenant_id: tenantId });
    const bangla = await ds
      .getRepository(Subject)
      .save({ name_en: 'Bangla', code: `B-${tag}`, tenant_id: tenantId });
    const shift = await ds.getRepository(Shift).save({
      tenant_id: tenantId,
      name: `Morning-${tag}`,
      day_starts_at: '08:00',
      day_ends_at: '13:00',
      sequence: 0,
    });
    const slots = [];
    for (const n of [1, 2, 3]) {
      slots.push(
        await ds.getRepository(PeriodSlot).save({
          tenant_id: tenantId,
          shift_id: shift.id,
          sequence: n,
          kind: PeriodSlotKind.CLASS,
          name: `P${n}`,
          starts_at: `0${7 + n}:00`,
          ends_at: `0${7 + n}:45`,
        }),
      );
    }

    // Real rows of this tenant: `upsert` drops embedded ids that are not.
    const topic = await ds.getRepository(SyllabusTopic).save({
      tenant_id: tenantId,
      class_id: klass.id,
      subject_id: math.id,
      name: 'Decimals',
      sequence: 1,
    });
    const exam = await ds.getRepository(Exam).save({
      tenant_id: tenantId,
      academic_year_id: year.id,
      class_id: klass.id,
      name: `Half-yearly ${tag}`,
      kind: ExamKind.TERM,
    });
    const lessons = [
      { id: 'l1', title: 'Fractions', periods: 3, notes: 'Use blocks' },
      { id: 'l2', title: 'Decimals', periods: 2, topic_id: topic.id },
    ];
    const exam_markers = [{ exam_id: exam.id, up_to_lesson_id: 'l1' }];
    const base = {
      tenant_id: tenantId,
      academic_year_id: year.id,
      section_id: section.id,
      subject_id: math.id,
    };
    await ds.getRepository(StudyPlan).save([
      {
        ...base,
        academic_term_id: term1.id,
        owner_override_teacher_id: teacher.id,
        lessons,
        exam_markers,
      },
      { ...base, academic_term_id: null, lessons: [lessons[0]], exam_markers: [] },
    ]);

    const common = { tenant_id: tenantId, section_id: section.id, date: '2026-03-02' };
    await ds.getRepository(LessonDelivery).save([
      {
        ...common,
        subject_id: math.id,
        period_slot_id: slots[0].id,
        status: LessonDeliveryStatus.TAUGHT,
        note: 'Went well',
        recorded_by_user_id: user.id,
      },
      {
        ...common,
        subject_id: bangla.id,
        period_slot_id: slots[1].id,
        status: LessonDeliveryStatus.PARTLY,
        is_extra: true,
        recorded_by_user_id: user.id,
      },
      {
        ...common,
        subject_id: math.id,
        period_slot_id: slots[2].id,
        status: LessonDeliveryStatus.NOT_TAUGHT,
        reason: LessonDeliveryReason.ON_LEAVE,
        auto: true,
      },
    ]);
    await ds.getRepository(StudyPlanTemplate).save({
      tenant_id: tenantId,
      name: `Class 6 Maths ${tag}`,
      class_grade: 6,
      subject_code: `M-${tag}`,
      lessons: [{ id: 'l1', title: 'Fractions', periods: 3 }],
    });
    return { user, teacher, year, klass, section, math, bangla, shift, slots, topic, exam };
  }

  type World = Awaited<ReturnType<typeof seed>>;

  /** Natural keys the way the export/validation services would resolve them. */
  async function contexts(w: World): Promise<{ ex: ExportContext; im: ImportContext }> {
    const section = await ds.getRepository(ClassSection).findOneOrFail({
      where: { id: w.section.id },
      relations: ['class', 'class.academic_year'],
    });
    const slots = await ds.getRepository(PeriodSlot).find({
      where: { shift_id: w.shift.id },
      relations: ['shift'],
    });
    const keys: Record<string, Record<string, string>> = {
      sections: { [w.section.id]: sectionsTab.keyOf(section) },
      subjects: { [w.math.id]: w.math.code, [w.bangla.id]: w.bangla.code },
      teachers: { [w.teacher.id]: w.teacher.employee_id },
      users: { [w.user.id]: w.user.email! },
      period_slots: Object.fromEntries(slots.map((s) => [s.id, periodSlotsTab.keyOf(s)])),
    };
    return {
      ex: { keyOf: (t, id) => keys[t]?.[id] ?? '' },
      im: {
        tenantId: TENANT,
        warn: () => undefined,
        ref: (t, key) => Object.entries(keys[t] ?? {}).find(([, k]) => k === key)?.[0],
      },
    };
  }

  /** Export -> delete the tenant's rows -> restore. Returns rows before and after, minus ids, relations and timestamps. */
  async function roundTrip<E extends object, R>(tab: TabSpec<E, R>, w: World) {
    const { ex, im } = await contexts(w);
    const strip = (rows: E[]) =>
      rows
        .map((r) => {
          const {
            id,
            created_at,
            updated_at,
            section,
            subject,
            period_slot,
            academic_year,
            academic_term,
            owner_override_teacher,
            recorded_by,
            ...rest
          } = r as Record<string, unknown>;
          void [
            id,
            created_at,
            updated_at,
            section,
            subject,
            period_slot,
            academic_year,
            academic_term,
            owner_override_teacher,
            recorded_by,
          ];
          return rest;
        })
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

    const before = await tab.load(TENANT, ds.manager);
    expect(before.length).toBeGreaterThan(0);
    const cellsList = before.map((entity) => {
      const row = tab.toRow(entity, ex);
      return Object.fromEntries(
        tab.columns.map((c) => [c.key, String(toCell(c.type, row[c.key]) ?? '')]),
      );
    });
    await ds
      .createQueryBuilder()
      .delete()
      .from(tab.entity as never)
      .where('tenant_id = :t', { t: TENANT })
      .execute();
    for (const [i, cells] of cellsList.entries()) {
      const parsed = tab.fromRow(cells, i + 2, im);
      if ('errors' in parsed) throw new Error(JSON.stringify(parsed.errors));
      await tab.upsert(parsed.row, null, TENANT, ds.manager);
    }
    const after = await tab.load(TENANT, ds.manager);
    // Ids are regenerated by `upsert`, so `strip` drops them and compares every other column.
    return { before: strip(before), after: strip(after) };
  }

  it('study plans keep both the term plan and the whole-year plan, every column', async () => {
    const w = await seed(TENANT, 'a');
    const { before, after } = await roundTrip(studyPlansTab, w);
    expect(before).toHaveLength(2);
    expect(after).toEqual(before);
    expect(after.filter((p) => p.academic_term_id === null)).toHaveLength(1);
  });

  it('lesson deliveries keep the extra row and the auto NOT_TAUGHT ON_LEAVE row', async () => {
    const w = await seed(TENANT, 'b');
    const { before, after } = await roundTrip(lessonDeliveriesTab, w);
    expect(before).toHaveLength(3);
    expect(after).toEqual(before);
  });

  it('study plan templates survive', async () => {
    const w = await seed(TENANT, 'c');
    const { before, after } = await roundTrip(studyPlanTemplatesTab, w);
    expect(after).toEqual(before);
  });

  it("another tenant's rows are neither exported nor touched", async () => {
    const w = await seed(TENANT, 'd');
    await seed(OTHER, 'e');
    for (const tab of [studyPlansTab, lessonDeliveriesTab, studyPlanTemplatesTab]) {
      const mine = await (tab as TabSpec<{ tenant_id: string }, unknown>).load(TENANT, ds.manager);
      expect(mine.every((e) => e.tenant_id === TENANT)).toBe(true);
      await roundTrip(tab as TabSpec<object, unknown>, w);
    }
    expect(await ds.getRepository(StudyPlan).countBy({ tenant_id: OTHER })).toBe(2);
    expect(await ds.getRepository(LessonDelivery).countBy({ tenant_id: OTHER })).toBe(3);
    expect(await ds.getRepository(StudyPlanTemplate).countBy({ tenant_id: OTHER })).toBe(1);
  });

  it("restore drops a topic_id / exam_id that is not this school's own", async () => {
    const w = await seed(TENANT, 'g');
    const theirs = await seed(OTHER, 'h');
    const { ex, im } = await contexts(w);
    const plan = (await studyPlansTab.load(TENANT, ds.manager)).find(
      (p) => p.academic_term_id !== null,
    )!;
    const row = studyPlansTab.toRow(plan, ex);
    const cells = Object.fromEntries(
      studyPlansTab.columns.map((c) => [c.key, String(toCell(c.type, row[c.key]) ?? '')]),
    );
    cells.lessons = JSON.stringify([
      { id: 'l1', title: 'Fractions', periods: 3 },
      { id: 'l2', title: 'Decimals', periods: 2, topic_id: theirs.topic.id },
    ]);
    cells.exam_markers = JSON.stringify([
      { exam_id: theirs.exam.id, up_to_lesson_id: 'l1' },
      { exam_id: w.exam.id, up_to_lesson_id: 'l2' },
    ]);
    const parsed = studyPlansTab.fromRow(cells, 2, im);
    if ('errors' in parsed) throw new Error(JSON.stringify(parsed.errors));
    const saved = await studyPlansTab.upsert(parsed.row, plan, TENANT, ds.manager);
    expect(saved.lessons[1]).toEqual({ id: 'l2', title: 'Decimals', periods: 2 });
    expect(saved.exam_markers).toEqual([{ exam_id: w.exam.id, up_to_lesson_id: 'l2' }]);
    // Upserting onto the existing plan keeps its term and owner.
    const reloaded = await ds.getRepository(StudyPlan).findOneByOrFail({ id: plan.id });
    expect(reloaded.academic_term_id).toBe(plan.academic_term_id);
    expect(reloaded.owner_override_teacher_id).toBe(w.teacher.id);
  });

  it('restoring a term that does not exist in the school fails with a clear message', async () => {
    const w = await seed(TENANT, 'f');
    const { im } = await contexts(w);
    const plans = await studyPlansTab.load(TENANT, ds.manager);
    const termPlan = plans.find((p) => p.academic_term_id !== null)!;
    const { ex } = await contexts(w);
    const row = studyPlansTab.toRow(termPlan, ex);
    const cells = Object.fromEntries(
      studyPlansTab.columns.map((c) => [c.key, String(toCell(c.type, row[c.key]) ?? '')]),
    );
    cells.term = `2026-f|9`;
    const parsed = studyPlansTab.fromRow(cells, 2, im);
    if ('errors' in parsed) throw new Error(JSON.stringify(parsed.errors));
    await expect(studyPlansTab.upsert(parsed.row, null, TENANT, ds.manager)).rejects.toThrow(
      'Term 2026-f|9 does not exist in this school; create the term first',
    );
  });
});
