import type { EntityManager } from 'typeorm';
import { EnrollmentStatus } from '@biddaloy/shared';
import { Enrollment } from '../../../students/entities/enrollment.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';

/**
 * The `enrollments` tab: a student's enrollment in a class (and optionally a
 * section) for a specific academic year.
 *
 * The real entity is `Enrollment`, table `enrollments`, declared at
 * `server/src/modules/students/entities/enrollment.entity.ts` — **not**
 * under `modules/enrollments/`, which holds only the controller/service.
 *
 * Unlike `teacher-assignments.tab.ts` / `students.tab.ts`, `class_id`,
 * `section_id`, and `academic_year_id` are all **real columns** on the
 * entity, not derived through a section chain — `section_id` is nullable.
 * There is no `deleted_at`, so `remove` is a hard delete.
 *
 * `enrollments` depends on `students`, `classes`, `academic_years` and
 * `sections`, and goes last in `peopleTabs` because `EXPECTED_TABS`
 * (`codec/registry.ts`) places it directly after `students`, with the fees
 * lane's tabs following.
 *
 * The partial unique index (`IDX_enr_active_student_year`, entity lines
 * 34-37) is on `(student_id, academic_year_id) WHERE enrollment_status =
 * 'ACTIVE'` — a student may hold one ACTIVE enrollment **per academic
 * year**. `upsert` below flips any other ACTIVE enrollment scoped to
 * `{tenant_id, student_id, academic_year_id}` to INACTIVE before saving,
 * matching `enrollments.service.ts:265-278`'s scope. Never widen this scope
 * to `student_id` alone — that would wrongly deactivate a student's
 * enrollment in a different year on every restore.
 */
export interface EnrollmentRow {
  id: string;
  student_id: string;
  class_id: string;
  academic_year_id: string;
  section_id: string | null;
  enrollment_status: EnrollmentStatus;
  enrolled_at: string; // ISO, as fromCell('datetime') produces
  // Referenced tabs' own natural-key text, kept beside the resolved ids so
  // `keyOf` builds the same string for a row as for an entity, with no
  // uuid ever appearing in a natural key.
  student_key: string;
  class_key: string;
  academic_year_key: string;
  section_key: string | null;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  {
    key: 'student',
    type: 'ref',
    ref: 'students',
    required: true,
    label: { en: 'Student', bn: 'শিক্ষার্থী' },
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
    // Optional: the entity's `section_id` is nullable.
    key: 'section',
    type: 'ref',
    ref: 'sections',
    label: { en: 'Section', bn: 'শাখা' },
  },
  {
    // Not `required`; an empty cell defaults to `ACTIVE` (the entity's own
    // default).
    key: 'enrollment_status',
    type: 'enum',
    enumValues: Object.values(EnrollmentStatus),
    label: { en: 'Enrollment status', bn: 'ভর্তির অবস্থা' },
  },
  {
    // Not `required`; an empty cell defaults to `new Date().toISOString()`,
    // matching the entity's own `default: () => 'now()'`.
    key: 'enrolled_at',
    type: 'datetime',
    label: { en: 'Enrolled at', bn: 'ভর্তির তারিখ' },
  },
];

/**
 * `Enrollment` columns deliberately left out of the workbook. The
 * completeness gate (`registry.completeness.spec.ts`) fails if a new
 * `Enrollment` column appears in neither `columns` nor here.
 */
const excluded: readonly string[] = [
  'student_id', // exported instead as the `student` ref column, keyed by the referenced tab's natural key
  'class_id', // exported instead as the `class` ref column, keyed by the referenced tab's natural key
  'section_id', // exported instead as the `section` ref column, keyed by the referenced tab's natural key
  'academic_year_id', // exported instead as the `academic_year` ref column, keyed by the referenced tab's natural key
];

export const enrollmentsTab: TabSpec<Enrollment, EnrollmentRow> = {
  name: 'enrollments',
  entity: Enrollment,
  excluded,
  // Every `ref` target above must be listed here, or `assertRegistryValid`
  // throws at boot (`registry.ts`).
  dependsOn: ['students', 'classes', 'academic_years', 'sections'],
  columns,
  naturalKey: ['student', 'academic_year'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<Enrollment[]> {
    // `class`/`section` are real columns and resolved via `ctx.keyOf` from
    // the stored ids, so no eager relation is needed for them. `student`
    // and `academic_year` are needed eagerly because `keyOf` reads their
    // natural-key fields directly off the relation.
    return m.find(Enrollment, {
      where: { tenant_id: tenantId },
      relations: ['student', 'academic_year'],
    });
  },

  toRow(entity: Enrollment, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      student: ctx.keyOf('students', entity.student_id),
      class: ctx.keyOf('classes', entity.class_id),
      academic_year: ctx.keyOf('academic_years', entity.academic_year_id),
      section: entity.section_id ? ctx.keyOf('sections', entity.section_id) : null,
      enrollment_status: entity.enrollment_status,
      enrolled_at: entity.enrolled_at,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: EnrollmentRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'enrollments', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }
      values[column.key] = result.value;
    }

    if (errors.length > 0) return { errors };

    const studentKey = values.student as string;
    const studentId = studentKey ? ctx.ref('students', studentKey) : undefined;
    if (studentKey && !studentId) {
      errors.push({
        tab: 'enrollments',
        row: rowNo,
        column: 'student',
        message: `Column "student": no student with the key "${studentKey}" was found.`,
        severity: 'error',
        value: studentKey,
      });
    }

    const classKey = values.class as string;
    const classId = classKey ? ctx.ref('classes', classKey) : undefined;
    if (classKey && !classId) {
      errors.push({
        tab: 'enrollments',
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
        tab: 'enrollments',
        row: rowNo,
        column: 'academic_year',
        message: `Column "academic_year": no academic year named "${academicYearKey}" was found.`,
        severity: 'error',
        value: academicYearKey,
      });
    }

    // `section` is the only optional ref: an empty cell means
    // `section_id: null`, not an error.
    const sectionKey = (values.section as string | null) ?? '';
    let sectionId: string | null = null;
    if (sectionKey) {
      const resolved = ctx.ref('sections', sectionKey);
      if (!resolved) {
        errors.push({
          tab: 'enrollments',
          row: rowNo,
          column: 'section',
          message: `Column "section": no section with the key "${sectionKey}" was found.`,
          severity: 'error',
          value: sectionKey,
        });
      } else {
        sectionId = resolved;
      }
    }

    if (errors.length > 0) return { errors };

    return {
      row: {
        id: values.id as string,
        student_id: studentId as string,
        class_id: classId as string,
        academic_year_id: academicYearId as string,
        section_id: sectionId,
        enrollment_status:
          (values.enrollment_status as EnrollmentStatus | null) ?? EnrollmentStatus.ACTIVE,
        enrolled_at: (values.enrolled_at as string | null) ?? new Date().toISOString(),
        student_key: studentKey,
        class_key: classKey,
        academic_year_key: academicYearKey,
        section_key: sectionKey ? sectionKey : null,
      },
    };
  },

  keyOf(x: EnrollmentRow | Enrollment): string {
    // A natural key is never a uuid: a row carries the referenced tabs' key
    // text directly, an entity must derive it from the (eagerly loaded)
    // relations.
    const studentKey =
      x instanceof Enrollment ? (x.student?.registration_number?.trim() ?? '') : x.student_key;
    const yearKey = x instanceof Enrollment ? (x.academic_year?.name ?? '') : x.academic_year_key;
    return `${studentKey}|${yearKey}`;
  },

  diffFields(row: EnrollmentRow, existing: Enrollment): string[] {
    const changed: string[] = [];
    if (row.student_id !== existing.student_id) changed.push('student');
    if (row.class_id !== existing.class_id) changed.push('class');
    if (row.academic_year_id !== existing.academic_year_id) changed.push('academic_year');
    if (row.section_id !== existing.section_id) changed.push('section');
    if (row.enrollment_status !== existing.enrollment_status) changed.push('enrollment_status');
    // `existing.enrolled_at` is a `Date`, `row.enrolled_at` an ISO string —
    // normalize both to ISO before comparing, or every row reports a
    // spurious change.
    if (new Date(existing.enrolled_at).toISOString() !== row.enrolled_at) {
      changed.push('enrolled_at');
    }
    return changed;
  },

  async upsert(
    row: EnrollmentRow,
    existing: Enrollment | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<Enrollment> {
    const enrollment =
      existing ??
      (await m.findOne(Enrollment, {
        where: {
          tenant_id: tenantId,
          student_id: row.student_id,
          academic_year_id: row.academic_year_id,
        },
      })) ??
      new Enrollment();

    enrollment.tenant_id = tenantId;
    enrollment.student_id = row.student_id;
    enrollment.class_id = row.class_id;
    enrollment.section_id = row.section_id;
    enrollment.academic_year_id = row.academic_year_id;
    enrollment.enrollment_status = row.enrollment_status;
    enrollment.enrolled_at = new Date(row.enrolled_at);

    // The real partial unique index is `(student_id, academic_year_id)
    // WHERE enrollment_status = 'ACTIVE'` (entity lines 34-37), not
    // `student_id` alone — a student legitimately holds one ACTIVE
    // enrollment per academic year. Flip any OTHER ACTIVE enrollment
    // scoped to {tenant_id, student_id, academic_year_id} to INACTIVE
    // BEFORE saving, so the index is never momentarily violated. Scoping
    // this by `student_id` alone would silently deactivate the student's
    // enrollments in other years on every restore.
    if (row.enrollment_status === EnrollmentStatus.ACTIVE) {
      const qb = m
        .createQueryBuilder()
        .update(Enrollment)
        .set({ enrollment_status: EnrollmentStatus.INACTIVE })
        .where('tenant_id = :tenantId', { tenantId })
        .andWhere('student_id = :studentId', { studentId: row.student_id })
        .andWhere('academic_year_id = :yearId', { yearId: row.academic_year_id })
        .andWhere('enrollment_status = :active', { active: EnrollmentStatus.ACTIVE });
      if (enrollment.id) qb.andWhere('id != :id', { id: enrollment.id });
      await qb.execute();
    }

    return m.save(Enrollment, enrollment);
  },

  async remove(entity: Enrollment, m: EntityManager): Promise<void> {
    // Hard delete: the entity has no `deleted_at`, so `softRemove` would
    // throw.
    await m.remove(Enrollment, entity);
  },
};
