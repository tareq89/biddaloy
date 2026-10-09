import { In, type EntityManager } from 'typeorm';
import {
  STUDY_PLAN_LIMITS,
  type StudyPlanExamMarker,
  type StudyPlanLesson,
} from '@biddaloy/shared';
import { StudyPlan } from '../../../study-plans/entities/study-plan.entity';
import { ClassSection } from '../../../academics/entities/class-section.entity';
import { AcademicTerm } from '../../../calendar/entities/academic-term.entity';
import { Exam } from '../../../exams/entities/exam.entity';
import { SyllabusTopic } from '../../../homework/entities/syllabus-topic.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';
import { sectionsTab } from './sections.tab';
import { subjectsTab } from './subjects.tab';

/**
 * The `study_plans` tab (Epic 66.0, [66.1.03]).
 *
 * Terms have no tab (`entity-coverage.ts`, #856), so the plan's term is
 * exported as a plain `term` cell, `"<academic year name>|<term seq>"`; an
 * empty cell is a whole-year plan (D14). Dropping it would turn two term
 * plans into two whole-year plans and hit the scope unique index on restore.
 * The validator has no database access, so `fromRow` only checks the cell's
 * shape; `upsert` resolves it against the tenant's `academic_terms`.
 */
export interface StudyPlanRow {
  id: string;
  section_id: string;
  subject_id: string;
  /** `"<year name>|<seq>"`, or null for a whole-year plan. */
  term: string | null;
  owner_override_teacher_id: string | null;
  lessons: StudyPlanLesson[];
  exam_markers: StudyPlanExamMarker[];
  section_key: string;
  subject_key: string;
}

const TERM_CELL = /^.+\|\d+$/;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Returns a message when `value` is not a valid lesson list (shared
 * `STUDY_PLAN_LIMITS`; every lesson has a unique text `id`). */
export function lessonsCellError(value: unknown): string | null {
  if (!Array.isArray(value)) return 'must be a JSON array of lessons.';
  const L = STUDY_PLAN_LIMITS;
  if (value.length > L.maxLessons) return `must have at most ${L.maxLessons} lessons.`;
  const ok = value.every(
    (l) =>
      isObject(l) &&
      typeof l.id === 'string' &&
      l.id !== '' &&
      typeof l.title === 'string' &&
      l.title.length <= L.titleMax &&
      Number.isInteger(l.periods) &&
      (l.periods as number) >= L.periodsMin &&
      (l.periods as number) <= L.periodsMax &&
      (l.notes === undefined || (typeof l.notes === 'string' && l.notes.length <= L.notesMax)) &&
      (l.topic_id === undefined || typeof l.topic_id === 'string'),
  );
  if (!ok) {
    return `every lesson needs a text "id", a "title" of at most ${L.titleMax} characters, a whole-number "periods" from ${L.periodsMin} to ${L.periodsMax}, and "notes" of at most ${L.notesMax} characters.`;
  }
  const ids = value.map((l) => (l as { id: string }).id);
  return new Set(ids).size === ids.length ? null : 'every lesson "id" must be unique.';
}

/** Returns a message when a marker is malformed or points at a lesson not in `lessonIds`. */
function markersCellError(value: unknown, lessonIds: ReadonlySet<string>): string | null {
  if (!Array.isArray(value)) return 'must be a JSON array of exam markers.';
  const ok = value.every(
    (m) => isObject(m) && typeof m.exam_id === 'string' && typeof m.up_to_lesson_id === 'string',
  );
  if (!ok) return 'every marker needs an "exam_id" and an "up_to_lesson_id".';
  const dangling = value.find((m) => !lessonIds.has(m.up_to_lesson_id as string));
  return dangling
    ? `"up_to_lesson_id" "${dangling.up_to_lesson_id}" is not a lesson in this row.`
    : null;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  {
    key: 'section',
    type: 'ref',
    ref: 'sections',
    required: true,
    label: { en: 'Section', bn: 'শাখা' },
  },
  {
    key: 'subject',
    type: 'ref',
    ref: 'subjects',
    required: true,
    label: { en: 'Subject', bn: 'বিষয়' },
  },
  { key: 'term', type: 'string', label: { en: 'Term', bn: 'টার্ম' } },
  {
    key: 'owner_override_teacher',
    type: 'ref',
    ref: 'teachers',
    label: { en: 'Owner teacher', bn: 'দায়িত্বপ্রাপ্ত শিক্ষক' },
  },
  { key: 'lessons', type: 'json', required: true, label: { en: 'Lessons', bn: 'পাঠসমূহ' } },
  {
    key: 'exam_markers',
    type: 'json',
    required: true,
    label: { en: 'Exam markers', bn: 'পরীক্ষার চিহ্ন' },
  },
];

const excluded: readonly string[] = [
  'section_id', // exported instead as the `section` ref column
  'subject_id', // exported instead as the `subject` ref column
  'academic_year_id', // derived from the section's class on import
  'academic_term_id', // exported instead as the plain `term` cell (terms have no tab, #856)
  'owner_override_teacher_id', // exported instead as the `owner_override_teacher` ref column
];

/** `"<year name>|<seq>"` for a plan loaded with `academic_year` and `academic_term`. */
function termKey(plan: StudyPlan): string | null {
  return plan.academic_term ? `${plan.academic_year?.name ?? ''}|${plan.academic_term.seq}` : null;
}

export const studyPlansTab: TabSpec<StudyPlan, StudyPlanRow> = {
  name: 'study_plans',
  entity: StudyPlan,
  excluded,
  // `exams` and `syllabus_topics` restore first so `upsert` can check the
  // ids embedded in `lessons`/`exam_markers` against this tenant.
  dependsOn: ['sections', 'subjects', 'teachers', 'exams', 'syllabus_topics'],
  columns,
  naturalKey: ['section', 'subject', 'term'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<StudyPlan[]> {
    // A plain `find` already skips soft-deleted plans (`deleted_at IS NULL`).
    return m.find(StudyPlan, {
      where: { tenant_id: tenantId },
      // `section.class.academic_year`: `sectionsTab.keyOf` reads it.
      relations: [
        'section',
        'section.class',
        'section.class.academic_year',
        'subject',
        'academic_year',
        'academic_term',
        'owner_override_teacher',
      ],
    });
  },

  toRow(entity: StudyPlan, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      section: ctx.keyOf('sections', entity.section_id),
      subject: ctx.keyOf('subjects', entity.subject_id),
      term: termKey(entity),
      owner_override_teacher: entity.owner_override_teacher_id
        ? ctx.keyOf('teachers', entity.owner_override_teacher_id)
        : null,
      lessons: entity.lessons ?? [],
      exam_markers: entity.exam_markers ?? [],
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: StudyPlanRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};
    const fail = (column: string, message: string, value?: string) =>
      errors.push({
        tab: 'study_plans',
        row: rowNo,
        column,
        message: `Column "${column}": ${message}`,
        severity: 'error',
        value,
      });

    for (const column of columns) {
      const result = fromCell(column, cells[column.key] ?? '', 'study_plans', rowNo);
      if ('error' in result) errors.push(result.error);
      else values[column.key] = result.value;
    }
    if (errors.length > 0) return { errors };

    const lessonsError = lessonsCellError(values.lessons);
    if (lessonsError) fail('lessons', lessonsError, cells.lessons);
    const lessonIds = new Set(
      lessonsError ? [] : (values.lessons as StudyPlanLesson[]).map((l) => l.id),
    );
    const markersError = lessonsError ? null : markersCellError(values.exam_markers, lessonIds);
    if (markersError) fail('exam_markers', markersError, cells.exam_markers);

    const term = (values.term as string | null) ?? null;
    if (term !== null && !TERM_CELL.test(term)) {
      fail('term', `"${term}" must look like "<academic year name>|<term number>".`, term);
    }

    const sectionKey = values.section as string;
    const sectionId = ctx.ref('sections', sectionKey);
    if (!sectionId) fail('section', `no section "${sectionKey}" was found.`, sectionKey);

    const subjectKey = values.subject as string;
    const subjectId = ctx.ref('subjects', subjectKey);
    if (!subjectId) fail('subject', `no subject with code "${subjectKey}" was found.`, subjectKey);

    const teacherKey = values.owner_override_teacher as string | null;
    let teacherId: string | null = null;
    if (teacherKey) {
      teacherId = ctx.ref('teachers', teacherKey) ?? null;
      if (!teacherId)
        fail('owner_override_teacher', `no teacher "${teacherKey}" was found.`, teacherKey);
    }

    if (errors.length > 0) return { errors };

    return {
      row: {
        id: values.id as string,
        section_id: sectionId as string,
        subject_id: subjectId as string,
        term,
        owner_override_teacher_id: teacherId,
        lessons: values.lessons as StudyPlanLesson[],
        exam_markers: values.exam_markers as StudyPlanExamMarker[],
        section_key: sectionKey,
        subject_key: subjectKey,
      },
    };
  },

  keyOf(x: StudyPlanRow | StudyPlan): string {
    const isEntity = x instanceof StudyPlan;
    const sectionKey = isEntity ? (x.section ? sectionsTab.keyOf(x.section) : '') : x.section_key;
    const subjectKey = isEntity ? (x.subject ? subjectsTab.keyOf(x.subject) : '') : x.subject_key;
    const term = isEntity ? termKey(x) : x.term;
    return `${sectionKey}|${subjectKey}|${term ?? ''}`;
  },

  diffFields(row: StudyPlanRow, existing: StudyPlan): string[] {
    const changed: string[] = [];
    if (row.owner_override_teacher_id !== existing.owner_override_teacher_id) {
      changed.push('owner_override_teacher');
    }
    if (JSON.stringify(row.lessons) !== JSON.stringify(existing.lessons)) changed.push('lessons');
    if (JSON.stringify(row.exam_markers) !== JSON.stringify(existing.exam_markers)) {
      changed.push('exam_markers');
    }
    return changed;
  },

  async upsert(
    row: StudyPlanRow,
    existing: StudyPlan | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<StudyPlan> {
    const section = await m.findOneOrFail(ClassSection, {
      where: { id: row.section_id, tenant_id: tenantId },
      relations: ['class'],
    });
    const yearId = section.class.academic_year_id;

    let termId: string | null = null;
    if (row.term !== null) {
      const cut = row.term.lastIndexOf('|');
      const term = await m.findOne(AcademicTerm, {
        where: {
          tenant_id: tenantId,
          academic_year_id: yearId,
          seq: Number(row.term.slice(cut + 1)),
          academic_year: { name: row.term.slice(0, cut) },
        },
      });
      if (!term) {
        throw new Error(`Term ${row.term} does not exist in this school; create the term first`);
      }
      termId = term.id;
    }

    // `topic_id`/`exam_id` are raw ids inside JSONB: keep only those that are
    // live rows of THIS tenant. A hand-edited workbook cannot point a plan at
    // another school's data, and ids from another tenant's backup (new ids on
    // restore) are dropped rather than left dangling.
    const topicIds = row.lessons.flatMap((l) => (l.topic_id ? [l.topic_id] : []));
    const examIds = row.exam_markers.map((mk) => mk.exam_id);
    const [topics, exams] = await Promise.all([
      topicIds.length
        ? m.find(SyllabusTopic, {
            where: { id: In(topicIds), tenant_id: tenantId },
            select: { id: true },
          })
        : [],
      examIds.length
        ? m.find(Exam, { where: { id: In(examIds), tenant_id: tenantId }, select: { id: true } })
        : [],
    ]);
    const liveTopics = new Set(topics.map((t) => t.id));
    const liveExams = new Set(exams.map((e) => e.id));
    const lessons = row.lessons.map((l) => {
      if (!l.topic_id || liveTopics.has(l.topic_id)) return l;
      const { topic_id: _dropped, ...rest } = l;
      return rest;
    });
    const markers = row.exam_markers.filter((mk) => liveExams.has(mk.exam_id));

    const plan = existing ?? new StudyPlan();
    plan.tenant_id = tenantId;
    plan.academic_year_id = yearId;
    plan.academic_term_id = termId;
    plan.section_id = row.section_id;
    plan.subject_id = row.subject_id;
    plan.owner_override_teacher_id = row.owner_override_teacher_id;
    plan.lessons = lessons;
    plan.exam_markers = markers;
    // Loaded relations would override the FK columns set above on save.
    // `undefined`, not `null`: on an existing plan, null clears the FK.
    plan.academic_term = undefined as never;
    plan.academic_year = undefined as never;
    plan.section = undefined as never;
    plan.subject = undefined as never;
    plan.owner_override_teacher = undefined as never;
    return m.save(StudyPlan, plan);
  },

  async remove(entity: StudyPlan, m: EntityManager): Promise<void> {
    await m.softRemove(StudyPlan, entity);
  },
};
