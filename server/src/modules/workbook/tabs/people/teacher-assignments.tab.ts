import type { EntityManager } from 'typeorm';
import { IsNull, Not } from 'typeorm';
import { TeacherAssignmentType } from '@biddaloy/shared';
import { TeacherClassSection } from '../../../academics/entities/teacher-class-section.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';
import { teachersTab } from './teachers.tab';
import { classesTab, sectionsTab, subjectsTab } from '../academics';

/**
 * The `teacher_assignments` tab: which teacher teaches which class section,
 * optionally for a specific subject.
 *
 * Sheet name is `teacher_assignments`; the real entity is
 * `TeacherClassSection`, table `teacher_class_sections`
 * (`teacher-class-section.entity.ts`). There is no `TeacherAssignment`
 * entity.
 *
 * `class` and `academic_year` are **not** columns on the entity — they are
 * derived from `section.class_id` and `section.class.academic_year_id`
 * (the same pattern `sections.tab.ts` uses for its own `academic_year`
 * column), which is why `load` must eagerly join
 * `section`, `section.class`, and `section.class.academic_year`.
 */
export interface TeacherAssignmentRow {
  id: string;
  teacher_id: string;
  section_id: string;
  subject_id: string | null;
  // Explicit from the `role` cell, or inferred (D20) when the cell is blank.
  assignment_type: TeacherAssignmentType;
  // Referenced tabs' own natural-key text, kept beside the resolved ids so
  // `keyOf` builds the same string for a row as for an entity, with no
  // uuid ever appearing in a natural key.
  teacher_key: string;
  class_key: string;
  academic_year_key: string;
  section_key: string;
  subject_key: string;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  {
    key: 'teacher',
    type: 'ref',
    ref: 'teachers',
    required: true,
    label: { en: 'Teacher', bn: 'শিক্ষক' },
  },
  {
    key: 'class',
    type: 'ref',
    ref: 'classes',
    required: true,
    label: { en: 'Class', bn: 'শ্রেণী' },
  },
  {
    key: 'academic_year',
    type: 'ref',
    ref: 'academic_years',
    required: true,
    label: { en: 'Academic year', bn: 'শিক্ষাবর্ষ' },
  },
  {
    key: 'section',
    type: 'ref',
    ref: 'sections',
    required: true,
    label: { en: 'Section', bn: 'শাখা' },
  },
  {
    // Optional: `subject_id IS NULL` means a class-teacher / whole-day
    // assignment (`teacher-class-section.entity.ts`).
    key: 'subject',
    type: 'ref',
    ref: 'subjects',
    label: { en: 'Subject', bn: 'বিষয়' },
  },
  {
    // [47.x D21] Optional: a blank cell is inferred as in D20 (subject ->
    // SUBJECT_TEACHER, else CLASS_TEACHER), which is what keeps backups taken
    // before this column existed restorable. ASSISTANT must be explicit.
    key: 'role',
    type: 'enum',
    enumValues: Object.values(TeacherAssignmentType),
    label: { en: 'Role', bn: 'ভূমিকা' },
  },
];

/**
 * `TeacherClassSection` columns deliberately left out of the workbook. The
 * completeness gate (`registry.completeness.spec.ts`) fails if a new
 * `TeacherClassSection` column appears in neither `columns` nor here.
 * `class` and `academic_year` need no entry here — they are not entity
 * columns at all, they are derived (see the file doc comment above).
 */
const excluded: readonly string[] = [
  'teacher_id', // exported instead as the `teacher` ref column, keyed by the referenced tab's natural key
  'section_id', // exported instead as the `section` ref column, keyed by the referenced tab's natural key
  'subject_id', // exported instead as the `subject` ref column, keyed by the referenced tab's natural key
  'assignment_type', // exported instead as the optional `role` column (same enum names)
];

export const teacherAssignmentsTab: TabSpec<TeacherClassSection, TeacherAssignmentRow> = {
  name: 'teacher_assignments',
  entity: TeacherClassSection,
  excluded,
  // Every `ref` target above must be listed here, or `assertRegistryValid`
  // throws at boot (`registry.ts`). `classes`/`academic_years` are needed
  // even though they are not entity columns, because the `class` and
  // `academic_year` columns still resolve against those tabs.
  dependsOn: ['teachers', 'classes', 'academic_years', 'sections', 'subjects'],
  columns,
  naturalKey: ['teacher', 'class', 'academic_year', 'section', 'subject'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<TeacherClassSection[]> {
    // `class`/`academic_year` are derived from the section, not stored, so
    // `toRow` and `keyOf` need this full eager chain or they produce empty
    // key fragments.
    return m.find(TeacherClassSection, {
      where: { tenant_id: tenantId },
      relations: ['teacher', 'section', 'section.class', 'section.class.academic_year', 'subject'],
    });
  },

  toRow(entity: TeacherClassSection, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      teacher: ctx.keyOf('teachers', entity.teacher_id),
      section: ctx.keyOf('sections', entity.section_id),
      // Derived by independent `keyOf` lookups rather than string-splitting
      // the section key: the section key already embeds pipes, so parsing
      // it back would be fragile (`sections.tab.ts` makes the same call).
      class: ctx.keyOf('classes', entity.section?.class_id ?? ''),
      academic_year: ctx.keyOf('academic_years', entity.section?.class?.academic_year_id ?? ''),
      subject: entity.subject_id ? ctx.keyOf('subjects', entity.subject_id) : null,
      role: entity.assignment_type,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: TeacherAssignmentRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'teacher_assignments', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }
      values[column.key] = result.value;
    }

    if (errors.length > 0) return { errors };

    const teacherKey = values.teacher as string;
    const teacherId = teacherKey ? ctx.ref('teachers', teacherKey) : undefined;
    if (teacherKey && !teacherId) {
      errors.push({
        tab: 'teacher_assignments',
        row: rowNo,
        column: 'teacher',
        message: `Column "teacher": no teacher with the key "${teacherKey}" was found.`,
        severity: 'error',
        value: teacherKey,
      });
    }

    const classKey = values.class as string;
    const classId = classKey ? ctx.ref('classes', classKey) : undefined;
    if (classKey && !classId) {
      errors.push({
        tab: 'teacher_assignments',
        row: rowNo,
        column: 'class',
        message: `Column "class": no class named "${classKey}" was found.`,
        severity: 'error',
        value: classKey,
      });
    }

    const academicYearKey = values.academic_year as string;
    const academicYearId = academicYearKey ? ctx.ref('academic_years', academicYearKey) : undefined;
    if (academicYearKey && !academicYearId) {
      errors.push({
        tab: 'teacher_assignments',
        row: rowNo,
        column: 'academic_year',
        message: `Column "academic_year": no academic year named "${academicYearKey}" was found.`,
        severity: 'error',
        value: academicYearKey,
      });
    }

    const sectionKey = values.section as string;
    const sectionId = sectionKey ? ctx.ref('sections', sectionKey) : undefined;
    if (sectionKey && !sectionId) {
      errors.push({
        tab: 'teacher_assignments',
        row: rowNo,
        column: 'section',
        message: `Column "section": no section with the key "${sectionKey}" was found.`,
        severity: 'error',
        value: sectionKey,
      });
    }

    // `subject` is the only optional ref: an empty cell means
    // `subject_id: null`, not an error.
    const subjectKey = (values.subject as string | null) ?? '';
    let subjectId: string | null = null;
    if (subjectKey) {
      const resolved = ctx.ref('subjects', subjectKey);
      if (!resolved) {
        errors.push({
          tab: 'teacher_assignments',
          row: rowNo,
          column: 'subject',
          message: `Column "subject": no subject with the code "${subjectKey}" was found.`,
          severity: 'error',
          value: subjectKey,
        });
      } else {
        subjectId = resolved;
      }
    }

    // [47.x D20/D21] Blank role -> inferred; an explicit role must agree with
    // `subject` (CK_tcs_subject_matches_type), or the insert would fail the
    // whole tab with a DB error instead of one clear row error.
    const roleCell = (values.role as string | null) ?? '';
    const inferred = subjectId
      ? TeacherAssignmentType.SUBJECT_TEACHER
      : TeacherAssignmentType.CLASS_TEACHER;
    const assignmentType = (roleCell || inferred) as TeacherAssignmentType;
    const isSubjectRole = assignmentType === TeacherAssignmentType.SUBJECT_TEACHER;
    if (roleCell && isSubjectRole !== Boolean(subjectId)) {
      errors.push({
        tab: 'teacher_assignments',
        row: rowNo,
        column: 'role',
        message: isSubjectRole
          ? `Column "role": ${roleCell} needs a subject, but the subject cell is empty.`
          : `Column "role": ${roleCell} cannot have a subject; leave the subject empty or use SUBJECT_TEACHER.`,
        severity: 'error',
        value: roleCell,
      });
    }

    if (errors.length > 0) return { errors };

    // `class`/`academic_year` are a readability/checkability aid, not the
    // authoritative parent — the section already determines its class and
    // year (`sections.tab.ts` makes the same call). Both are still resolved
    // above (so a wrong value is caught as a `RowError`), but no further
    // cross-check against the section's own class/year is done here: the
    // section key already embeds pipe-joined fragments of its own class key
    // (`classesTab.keyOf` = `${name}|${academicYearName}`), so textually comparing
    // it against `classKey` would be fragile rather than authoritative.

    return {
      row: {
        id: values.id as string,
        teacher_id: teacherId as string,
        section_id: sectionId as string,
        subject_id: subjectId,
        assignment_type: assignmentType,
        teacher_key: teacherKey,
        class_key: classKey,
        academic_year_key: academicYearKey,
        section_key: sectionKey,
        subject_key: subjectKey,
      },
    };
  },

  keyOf(x: TeacherAssignmentRow | TeacherClassSection): string {
    // A natural key is never a uuid: a row carries the referenced tabs' key
    // text directly, an entity must derive it from the (eagerly loaded)
    // relations. Reuses the other tabs' own `keyOf` rather than
    // re-deriving, exactly as `sections.tab.ts`/`class-subjects.tab.ts` do.
    if (x instanceof TeacherClassSection) {
      const teacherKey = x.teacher ? teachersTab.keyOf(x.teacher) : '';
      const classKey = x.section?.class ? classesTab.keyOf(x.section.class) : '';
      const academicYearKey = x.section?.class?.academic_year?.name ?? '';
      const sectionKey = x.section ? sectionsTab.keyOf(x.section) : '';
      const subjectKey = x.subject ? subjectsTab.keyOf(x.subject) : '';
      return `${teacherKey}|${classKey}|${academicYearKey}|${sectionKey}|${subjectKey}`;
    }
    return `${x.teacher_key}|${x.class_key}|${x.academic_year_key}|${x.section_key}|${x.subject_key}`;
  },

  // One CLASS_TEACHER per section: two different teachers marked CLASS for the
  // same section in one file is a validation error (D9), and a TEMPLATE import
  // may not displace the section's current class teacher (D10 replaces).
  secondaryKeyOf(x: TeacherAssignmentRow | TeacherClassSection): string | null {
    return x.assignment_type === TeacherAssignmentType.CLASS_TEACHER
      ? `CLASS_TEACHER of section ${x.section_id}`
      : null;
  },

  diffFields(row: TeacherAssignmentRow, existing: TeacherClassSection): string[] {
    // In practice `teacher_id`/`section_id`/`subject_id` are all in the
    // natural key, so a matched row differs in nothing — this is reported
    // honestly (usually empty) rather than faked.
    const changed: string[] = [];
    if (row.teacher_id !== existing.teacher_id) changed.push('teacher_id');
    if (row.section_id !== existing.section_id) changed.push('section_id');
    if (row.subject_id !== existing.subject_id) changed.push('subject_id');
    if (row.assignment_type !== existing.assignment_type) changed.push('assignment_type');
    return changed;
  },

  async upsert(
    row: TeacherAssignmentRow,
    existing: TeacherClassSection | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<TeacherClassSection> {
    // Tenant-scoped lookup is safe here — unlike `teachers.tab.ts`, there is
    // no global unique constraint on this entity. `IsNull()` is required
    // rather than `where: { subject_id: null }`, which does not reliably
    // generate `IS NULL` in TypeORM and would re-insert a duplicate row on
    // every re-run, tripping the partial unique index for the
    // `subject_id IS NULL` case.
    const assignment =
      existing ??
      (await m.findOne(TeacherClassSection, {
        where: {
          tenant_id: tenantId,
          teacher_id: row.teacher_id,
          section_id: row.section_id,
          subject_id: row.subject_id === null ? IsNull() : row.subject_id,
        },
      })) ??
      new TeacherClassSection();

    // TypeORM takes the FK from a loaded relation object over the plain
    // `*_id` column, so an id-matched row whose teacher/section/subject cell
    // changed would silently save the OLD ids. Drop the loaded relations so
    // the column values below win.
    Object.assign(assignment, { teacher: undefined, section: undefined, subject: undefined });
    assignment.tenant_id = tenantId;
    assignment.teacher_id = row.teacher_id;
    assignment.section_id = row.section_id;
    assignment.subject_id = row.subject_id;
    assignment.assignment_type = row.assignment_type;

    // Why the ordering lives here and not in the restore processor: the
    // processor upserts every row of this tab before `deleteByAbsence` runs,
    // so a class-teacher swap A -> B would insert B while A's CLASS_TEACHER
    // row still exists and fail `UQ_tcs_section_class_teacher` (#1048). D10
    // says a new class teacher replaces the old one, so remove the section's
    // other CLASS_TEACHER rows first, in the same transaction (`m`) and for
    // this tenant only. An ASSISTANT becoming CLASS needs no delete: it is the
    // same (teacher, section, no subject) natural key, so the lookup above
    // already found that row and it is updated in place, which also keeps
    // `UQ_tcs_teacher_section_homeroom` satisfied.
    if (row.assignment_type === TeacherAssignmentType.CLASS_TEACHER) {
      await m.delete(TeacherClassSection, {
        tenant_id: tenantId,
        section_id: row.section_id,
        assignment_type: TeacherAssignmentType.CLASS_TEACHER,
        teacher_id: Not(row.teacher_id),
      });
    }

    return m.save(TeacherClassSection, assignment);
  },

  async remove(entity: TeacherClassSection, m: EntityManager): Promise<void> {
    // Hard delete: the entity has no `deleted_at`, so `softRemove` would
    // throw.
    await m.remove(TeacherClassSection, entity);
  },
};
