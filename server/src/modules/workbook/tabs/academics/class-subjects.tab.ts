import type { EntityManager } from 'typeorm';
import { ClassSubject } from '../../../academics/entities/class-subject.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';
import { classesTab } from './classes.tab';

/**
 * The `class_subjects` tab: which subjects a class offers in a given
 * academic year.
 *
 * Three `ref` columns: `class` resolves against `classes` (whose own
 * natural key already embeds its academic year), `academic_year` resolves
 * against `academic_years` directly (carried on the row for readability,
 * same pattern as `sections`), and `subject` resolves against `subjects` —
 * whose natural key is `code`, so `ctx.ref('subjects', code)` /
 * `ctx.keyOf('subjects', subjectId)` already resolve by code with no
 * special-casing needed here.
 */

export interface ClassSubjectRow {
  id: string;
  class_id: string;
  academic_year_id: string;
  subject_id: string;
  is_optional: boolean;
  // The referenced tabs' own natural keys, kept alongside the resolved
  // local ids so `keyOf` can build the same key format for a row as for an
  // entity, without a uuid ever appearing in a natural key.
  class_key: string;
  academic_year_key: string;
  subject_key: string;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
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
    key: 'subject',
    type: 'ref',
    ref: 'subjects',
    required: true,
    label: { en: 'Subject', bn: 'বিষয়' },
  },
  {
    key: 'is_optional',
    type: 'bool',
    required: true,
    label: { en: 'Is optional', bn: 'ঐচ্ছিক কিনা' },
  },
];

/**
 * Entity columns deliberately left out of the workbook. The completeness
 * gate (`registry.completeness.spec.ts`) fails if a new `ClassSubject`
 * column appears in neither `columns` nor here.
 */
const excluded: readonly string[] = [
  'class_id', // exported instead as the `class` ref column, keyed by the referenced tab's natural key
  'subject_id', // exported instead as the `subject` ref column, keyed by the subject's `code`
  'academic_year_id', // exported instead as the `academic_year` ref column, keyed by the referenced tab's natural key
];

export const classSubjectsTab: TabSpec<ClassSubject, ClassSubjectRow> = {
  name: 'class_subjects',
  entity: ClassSubject,
  excluded,
  // `academic_years` is added alongside the ticket's `classes, subjects` list
  // because the registry's completeness gate requires every `ref` column's
  // tab (including `academic_year`) to appear in `dependsOn`.
  dependsOn: ['classes', 'subjects', 'academic_years'],
  columns,
  naturalKey: ['class', 'academic_year', 'subject'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<ClassSubject[]> {
    // `class` (and its own `academic_year`), `subject`, and `academic_year`
    // are loaded eagerly: `keyOf` needs each referenced tab's natural-key
    // text (never a uuid) to build a key that matches a freshly-imported row.
    return m.find(ClassSubject, {
      where: { tenant_id: tenantId },
      relations: ['class', 'class.academic_year', 'subject', 'academic_year'],
    });
  },

  toRow(entity: ClassSubject, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      class: ctx.keyOf('classes', entity.class_id),
      academic_year: ctx.keyOf('academic_years', entity.academic_year_id),
      subject: ctx.keyOf('subjects', entity.subject_id),
      is_optional: entity.is_optional,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: ClassSubjectRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'class_subjects', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }
      values[column.key] = result.value;
    }

    if (errors.length > 0) return { errors };

    let classId: string | undefined;
    const classKey = values.class as string;
    if (classKey) {
      classId = ctx.ref('classes', classKey);
      if (!classId) {
        errors.push({
          tab: 'class_subjects',
          row: rowNo,
          column: 'class',
          message: `Column "class": no class named "${classKey}" was found.`,
          severity: 'error',
          value: classKey,
        });
      }
    }

    let academicYearId: string | undefined;
    const academicYearKey = values.academic_year as string;
    if (academicYearKey) {
      academicYearId = ctx.ref('academic_years', academicYearKey);
      if (!academicYearId) {
        errors.push({
          tab: 'class_subjects',
          row: rowNo,
          column: 'academic_year',
          message: `Column "academic_year": no academic year named "${academicYearKey}" was found.`,
          severity: 'error',
          value: academicYearKey,
        });
      }
    }

    let subjectId: string | undefined;
    const subjectKey = values.subject as string;
    if (subjectKey) {
      subjectId = ctx.ref('subjects', subjectKey);
      if (!subjectId) {
        errors.push({
          tab: 'class_subjects',
          row: rowNo,
          column: 'subject',
          message: `Column "subject": no subject with code "${subjectKey}" was found.`,
          severity: 'error',
          value: subjectKey,
        });
      }
    }

    if (errors.length > 0) return { errors };

    return {
      row: {
        id: values.id as string,
        class_id: classId as string,
        academic_year_id: academicYearId as string,
        subject_id: subjectId as string,
        is_optional: values.is_optional as boolean,
        class_key: classKey,
        academic_year_key: academicYearKey,
        subject_key: subjectKey,
      },
    };
  },

  keyOf(x: ClassSubjectRow | ClassSubject): string {
    // A natural key is never a uuid (see key-index.ts): a row carries the
    // referenced tabs' key text directly, an entity must derive it from the
    // (eagerly loaded) `class`, `academic_year`, and `subject` relations.
    const classKey =
      x instanceof ClassSubject ? (x.class ? classesTab.keyOf(x.class) : '') : x.class_key;
    const yearKey = x instanceof ClassSubject ? (x.academic_year?.name ?? '') : x.academic_year_key;
    const subjectKey = x instanceof ClassSubject ? (x.subject?.code ?? '') : x.subject_key;
    return `${classKey}|${yearKey}|${subjectKey}`;
  },

  diffFields(row: ClassSubjectRow, existing: ClassSubject): string[] {
    const changed: string[] = [];
    if (row.class_id !== existing.class_id) changed.push('class');
    if (row.academic_year_id !== existing.academic_year_id) changed.push('academic_year');
    if (row.subject_id !== existing.subject_id) changed.push('subject');
    if (row.is_optional !== existing.is_optional) changed.push('is_optional');
    return changed;
  },

  async upsert(
    row: ClassSubjectRow,
    existing: ClassSubject | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<ClassSubject> {
    const classSubject = existing ?? new ClassSubject();
    classSubject.tenant_id = tenantId;
    classSubject.class_id = row.class_id;
    classSubject.academic_year_id = row.academic_year_id;
    classSubject.subject_id = row.subject_id;
    classSubject.is_optional = row.is_optional;

    return m.save(ClassSubject, classSubject);
  },

  async remove(entity: ClassSubject, m: EntityManager): Promise<void> {
    await m.softRemove(ClassSubject, entity);
  },
};
