import { describe, expect, it } from 'vitest';
import { StudyPlan } from '../../../study-plans/entities/study-plan.entity';
import { LessonDelivery } from '../../../study-plans/entities/lesson-delivery.entity';
import { StudyPlanTemplate } from '../../../study-plans/entities/study-plan-template.entity';
import { AcademicYear } from '../../../academics/entities/academic-year.entity';
import { Class } from '../../../academics/entities/class.entity';
import { ClassSection } from '../../../academics/entities/class-section.entity';
import { Subject } from '../../../academics/entities/subject.entity';
import { AcademicTerm } from '../../../calendar/entities/academic-term.entity';
import { PeriodSlot } from '../../../routines/entities/period-slot.entity';
import { Shift } from '../../../routines/entities/shift.entity';
import { cellText, toCell } from '../../codec/cell-format';
import type { ExportContext, ImportContext, TabSpec } from '../../codec/tab-spec';
import { studyPlansTab } from './study-plans.tab';
import { lessonDeliveriesTab } from './lesson-deliveries.tab';
import { studyPlanTemplatesTab } from './study-plan-templates.tab';

const TENANT = '11111111-1111-4111-8111-111111111111';
const ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const SECTION_ID = '66666666-6666-4666-8666-666666666666';
const SUBJECT_ID = '77777777-7777-4777-8777-777777777777';
const TEACHER_ID = '88888888-8888-4888-8888-888888888888';
const SLOT_ID = '99999999-9999-4999-8999-999999999999';
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
// Section key = `${classKey}|${yearName}|${sectionName}`; class key = `${name}|${year}|${shift}|${version}`.
const SECTION_KEY = 'Six|2026||'.concat('|2026|A');

const KEYS: Record<string, Record<string, string>> = {
  sections: { [SECTION_ID]: SECTION_KEY },
  subjects: { [SUBJECT_ID]: 'MATH' },
  teachers: { [TEACHER_ID]: 'EMP-1' },
  period_slots: { [SLOT_ID]: 'Morning|1' },
  users: { [USER_ID]: 'rec@x.test' },
};
const exportCtx: ExportContext = { keyOf: (t, id) => KEYS[t]?.[id] ?? '' };
const importCtx: ImportContext = {
  tenantId: TENANT,
  ref: (t, key) => Object.entries(KEYS[t] ?? {}).find(([, k]) => k === key)?.[0],
  warn: () => undefined,
};

function toCells<E, R>(tab: TabSpec<E, R>, entity: E): Record<string, string> {
  const row = tab.toRow(entity, exportCtx);
  const cells: Record<string, string> = {};
  for (const c of tab.columns) {
    const cell = toCell(c.type, row[c.key]);
    cells[c.key] = cellText(cell === null ? '' : String(cell));
  }
  return cells;
}

function rowOrThrow<E, R>(tab: TabSpec<E, R>, cells: Record<string, string>): R {
  const result = tab.fromRow(cells, 2, importCtx);
  if ('errors' in result) throw new Error(JSON.stringify(result.errors));
  return result.row;
}

function errorsOf<E, R>(tab: TabSpec<E, R>, cells: Record<string, string>) {
  const result = tab.fromRow(cells, 2, importCtx);
  if (!('errors' in result)) throw new Error('expected row errors');
  return result.errors;
}

const lessons = [{ id: 'l1', title: 'Fractions', periods: 3 }];
const markers = [{ exam_id: '22222222-2222-4222-8222-222222222222', up_to_lesson_id: 'l1' }];

/** What `load()` hands back: section -> class -> year, plus the plan's year and term. */
function makePlan(overrides: Partial<StudyPlan> = {}): StudyPlan {
  const year = Object.assign(new AcademicYear(), { name: '2026' });
  const klass = Object.assign(new Class(), { name: 'Six', academic_year: year });
  return Object.assign(new StudyPlan(), {
    id: ID,
    tenant_id: TENANT,
    section_id: SECTION_ID,
    section: Object.assign(new ClassSection(), { class: klass, section_name: 'A' }),
    subject_id: SUBJECT_ID,
    subject: Object.assign(new Subject(), { code: 'MATH' }),
    academic_year: year,
    academic_term: Object.assign(new AcademicTerm(), { seq: 2 }),
    academic_term_id: 'tttttttt',
    owner_override_teacher_id: TEACHER_ID,
    lessons,
    exam_markers: markers,
    ...overrides,
  });
}

describe('studyPlansTab', () => {
  it('exports the term as "<year>|<seq>" and "" for a whole-year plan', () => {
    expect(toCells(studyPlansTab, makePlan()).term).toBe('2026|2');
    expect(
      toCells(studyPlansTab, makePlan({ academic_term: null, academic_term_id: null })).term,
    ).toBe('');
  });

  it('round-trips a term plan and keeps the entity and row keys equal', () => {
    const plan = makePlan();
    const row = rowOrThrow(studyPlansTab, toCells(studyPlansTab, plan));
    expect(row).toMatchObject({
      section_id: SECTION_ID,
      subject_id: SUBJECT_ID,
      term: '2026|2',
      owner_override_teacher_id: TEACHER_ID,
      lessons,
      exam_markers: markers,
    });
    expect(studyPlansTab.keyOf(row)).toBe(studyPlansTab.keyOf(plan));
    expect(studyPlansTab.diffFields(row, plan)).toEqual([]);
  });

  it('an empty term cell is a whole-year plan (null), with a different key from a term plan', () => {
    const whole = makePlan({ academic_term: null, academic_term_id: null });
    const row = rowOrThrow(studyPlansTab, toCells(studyPlansTab, whole));
    expect(row.term).toBeNull();
    expect(studyPlansTab.keyOf(row)).not.toBe(studyPlansTab.keyOf(makePlan()));
  });

  it('rejects a malformed term cell with one row error naming the column', () => {
    const errors = errorsOf(studyPlansTab, {
      ...toCells(studyPlansTab, makePlan()),
      term: 'Term 2',
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ column: 'term', severity: 'error' });
  });

  it('rejects a non-array lessons cell with one row error', () => {
    const errors = errorsOf(studyPlansTab, {
      ...toCells(studyPlansTab, makePlan()),
      lessons: '{"title":"x"}',
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].column).toBe('lessons');
  });

  it('rejects a lesson with periods below 1', () => {
    const errors = errorsOf(studyPlansTab, {
      ...toCells(studyPlansTab, makePlan()),
      lessons: '[{"id":"l1","title":"x","periods":0}]',
    });
    expect(errors[0].column).toBe('lessons');
  });

  it('rejects lessons without an id, with a duplicate id, or over the shared limits', () => {
    const cells = toCells(studyPlansTab, makePlan());
    for (const bad of [
      '[{"title":"x","periods":1}]',
      '[{"id":"a","title":"x","periods":1},{"id":"a","title":"y","periods":1}]',
      '[{"id":"a","title":"x","periods":21}]',
      `[{"id":"a","title":"${'x'.repeat(201)}","periods":1}]`,
    ]) {
      expect(errorsOf(studyPlansTab, { ...cells, lessons: bad })[0].column).toBe('lessons');
    }
  });

  it('rejects a marker whose up_to_lesson_id is not a lesson of the row', () => {
    const errors = errorsOf(studyPlansTab, {
      ...toCells(studyPlansTab, makePlan()),
      exam_markers: '[{"exam_id":"e1","up_to_lesson_id":"nope"}]',
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].column).toBe('exam_markers');
  });

  it('rejects an unknown section with one row error', () => {
    const errors = errorsOf(studyPlansTab, {
      ...toCells(studyPlansTab, makePlan()),
      section: 'nope',
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].column).toBe('section');
  });
});

describe('lessonDeliveriesTab', () => {
  function makeDelivery(overrides: Partial<LessonDelivery> = {}): LessonDelivery {
    const year = Object.assign(new AcademicYear(), { name: '2026' });
    const klass = Object.assign(new Class(), { name: 'Six', academic_year: year });
    return Object.assign(new LessonDelivery(), {
      id: ID,
      tenant_id: TENANT,
      section_id: SECTION_ID,
      section: Object.assign(new ClassSection(), { class: klass, section_name: 'A' }),
      subject_id: SUBJECT_ID,
      date: '2026-03-02',
      period_slot_id: SLOT_ID,
      period_slot: Object.assign(new PeriodSlot(), {
        sequence: 1,
        shift: Object.assign(new Shift(), { name: 'Morning' }),
      }),
      status: 'TAUGHT',
      reason: null,
      note: null,
      is_extra: false,
      auto: false,
      recorded_by_user_id: USER_ID,
      ...overrides,
    });
  }

  it('round-trips a delivery; entity and row keys match', () => {
    const delivery = makeDelivery();
    const row = rowOrThrow(lessonDeliveriesTab, toCells(lessonDeliveriesTab, delivery));
    expect(row).toMatchObject({ date: '2026-03-02', recorded_by_user_id: USER_ID, auto: false });
    expect(lessonDeliveriesTab.keyOf(row)).toBe(lessonDeliveriesTab.keyOf(delivery));
    expect(lessonDeliveriesTab.diffFields(row, delivery)).toEqual([]);
  });

  it('keeps an auto NOT_TAUGHT ON_LEAVE row', () => {
    const delivery = makeDelivery({
      status: 'NOT_TAUGHT',
      reason: 'ON_LEAVE',
      auto: true,
      recorded_by_user_id: null,
    });
    const row = rowOrThrow(lessonDeliveriesTab, toCells(lessonDeliveriesTab, delivery));
    expect(row).toMatchObject({ status: 'NOT_TAUGHT', reason: 'ON_LEAVE', auto: true });
    expect(row.recorded_by_user_id).toBeNull();
  });

  it('rejects a note longer than deliveryNoteMax as a row error', () => {
    const errors = errorsOf(lessonDeliveriesTab, {
      ...toCells(lessonDeliveriesTab, makeDelivery()),
      note: 'x'.repeat(501),
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].column).toBe('note');
  });

  it('rejects NOT_TAUGHT without a reason', () => {
    const errors = errorsOf(lessonDeliveriesTab, {
      ...toCells(lessonDeliveriesTab, makeDelivery()),
      status: 'NOT_TAUGHT',
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].column).toBe('reason');
  });

  it('rejects a reason on a TAUGHT row', () => {
    const errors = errorsOf(lessonDeliveriesTab, {
      ...toCells(lessonDeliveriesTab, makeDelivery()),
      reason: 'OTHER',
    });
    expect(errors[0].column).toBe('reason');
  });
});

describe('studyPlanTemplatesTab', () => {
  const template = Object.assign(new StudyPlanTemplate(), {
    id: ID,
    tenant_id: TENANT,
    name: 'Class 6 Maths',
    class_grade: 6,
    subject_code: 'MATH',
    lessons,
  });

  it('round-trips a template; key is the name', () => {
    const row = rowOrThrow(studyPlanTemplatesTab, toCells(studyPlanTemplatesTab, template));
    expect(row).toMatchObject({
      name: 'Class 6 Maths',
      class_grade: 6,
      subject_code: 'MATH',
      lessons,
    });
    expect(studyPlanTemplatesTab.keyOf(row)).toBe(studyPlanTemplatesTab.keyOf(template));
    expect(studyPlanTemplatesTab.diffFields(row, template)).toEqual([]);
  });

  it('rejects a non-array lessons cell', () => {
    const errors = errorsOf(studyPlanTemplatesTab, {
      ...toCells(studyPlanTemplatesTab, template),
      lessons: '"x"',
    });
    expect(errors[0].column).toBe('lessons');
  });
});
