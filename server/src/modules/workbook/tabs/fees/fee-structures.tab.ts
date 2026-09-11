import type { EntityManager } from 'typeorm';
import { FeeStructure } from '../../../fees/entities/fee-structure.entity';
import { FeeStructureStudent } from '../../../fees/entities/fee-structure-student.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';
import { FeeApplicability, FeeType } from '@biddaloy/shared';
import { classesTab } from '../academics/classes.tab';
import { academicYearsTab } from '../academics/academic-years.tab';
import { sectionsTab } from '../academics/sections.tab';

/**
 * The `fee_structures` tab: the fee templates a school generates monthly
 * student fees from.
 *
 * `class` and `academic_year` are `ref` columns like `sections.tab.ts`;
 * `section` is the same but optional. `selected_students` is a `ref-list`
 * column against the `students` tab (`tabs/people/students.tab.ts`), keyed
 * by each student's `registration_number` — never a uuid, same rule as every
 * other ref. `ctx.ref('students', key)` / `ctx.keyOf('students', id)`
 * resolve against that tab, which the registry applies first via
 * `dependsOn`. `assertRegistryValid`'s partial mode (registry.ts)
 * tolerates the dangling `dependsOn`/`ref` target, and this file's own tests
 * supply a fake `ImportContext`/`ExportContext` for `students`, so they don't
 * need the real tab.
 */

export interface FeeStructureRow {
  id: string;
  name: string;
  fee_type: FeeType;
  amount: string;
  applicability: FeeApplicability;
  class_id: string;
  class_key: string;
  academic_year_id: string;
  academic_year_key: string;
  section_id: string | null;
  section_key: string | null;
  month: number;
  is_recurring: boolean;
  // Resolved student ids plus their natural keys (registration numbers), in
  // the same order as the cell, so `upsert` can rebuild the pivot rows and
  // `keyOf`/diffing never has to re-resolve anything.
  selected_student_ids: string[];
  selected_student_keys: string[];
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  { key: 'name', type: 'string', required: true, label: { en: 'Name', bn: 'নাম' } },
  {
    key: 'fee_type',
    type: 'enum',
    required: true,
    enumValues: Object.values(FeeType),
    label: { en: 'Fee type', bn: 'ফি এর ধরন' },
  },
  { key: 'amount', type: 'money', required: true, label: { en: 'Amount', bn: 'পরিমাণ' } },
  {
    key: 'applicability',
    type: 'enum',
    required: true,
    enumValues: Object.values(FeeApplicability),
    label: { en: 'Applicability', bn: 'প্রযোজ্যতা' },
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
    label: { en: 'Section', bn: 'শাখা' },
  },
  { key: 'month', type: 'int', required: true, label: { en: 'Month', bn: 'মাস' } },
  {
    key: 'is_recurring',
    type: 'bool',
    required: true,
    label: { en: 'Recurring', bn: 'পুনরাবৃত্ত' },
  },
  {
    key: 'selected_students',
    type: 'ref-list',
    ref: 'students',
    label: { en: 'Selected students', bn: 'নির্বাচিত শিক্ষার্থী' },
  },
];

const excluded: readonly string[] = [
  'class_id', // exported instead as the `class` ref column
  'section_id', // exported instead as the `section` ref column
  'academic_year_id', // exported instead as the `academic_year` ref column
];

const MAX_LENGTHS: Record<string, number> = {
  name: 100,
};

export const feeStructuresTab: TabSpec<FeeStructure, FeeStructureRow> = {
  name: 'fee_structures',
  entity: FeeStructure,
  excluded,
  dependsOn: ['classes', 'academic_years', 'sections', 'students'],
  columns,
  // `section` belongs in the key: it is nullable and independent of
  // `applicability`, so one class/year/type/month/name can legitimately
  // carry a different amount per section. Without it those rows share a
  // key, `KeyIndex` flags it ambiguous and collapses them to one id, and
  // delete-by-absence then removes the loser. (The ticket's column list
  // omitted `section`; no unique constraint on the entity backs it up.)
  naturalKey: ['class', 'academic_year', 'section', 'fee_type', 'month', 'name'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<FeeStructure[]> {
    // `class`, `section` and their own `academic_year` are loaded eagerly so
    // `toRow`/`keyOf` never need a uuid to build a natural key. `students` is
    // read as a leaf array of pivot rows, each carrying only its own
    // `student_id` — the row-level student key is resolved through
    // `ctx.keyOf('students', id)` in `toRow`, not from a loaded relation,
    // because `selected_students` needs the *students* tab's own key format,
    // not a locally reconstructed one.
    return m.find(FeeStructure, {
      where: { tenant_id: tenantId },
      relations: ['class', 'class.academic_year', 'section', 'academic_year', 'selected_students'],
    });
  },

  toRow(entity: FeeStructure, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      name: entity.name,
      fee_type: entity.fee_type,
      amount: entity.amount,
      applicability: entity.applicability,
      class: ctx.keyOf('classes', entity.class_id),
      academic_year: ctx.keyOf('academic_years', entity.academic_year_id),
      section: entity.section_id ? ctx.keyOf('sections', entity.section_id) : null,
      month: entity.month,
      is_recurring: entity.is_recurring,
      selected_students: (entity.selected_students ?? []).map((link) =>
        ctx.keyOf('students', link.student_id),
      ),
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: FeeStructureRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'fee_structures', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }

      const limit = MAX_LENGTHS[column.key];
      if (limit !== undefined && typeof result.value === 'string' && result.value.length > limit) {
        errors.push({
          tab: 'fee_structures',
          row: rowNo,
          column: column.key,
          message: `Column "${column.key}": is longer than the ${limit} characters allowed.`,
          severity: 'error',
          value: raw,
        });
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
          tab: 'fee_structures',
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
          tab: 'fee_structures',
          row: rowNo,
          column: 'academic_year',
          message: `Column "academic_year": no academic year named "${academicYearKey}" was found.`,
          severity: 'error',
          value: academicYearKey,
        });
      }
    }

    let sectionId: string | null = null;
    const sectionKey = (values.section as string | null) ?? null;
    if (sectionKey) {
      const resolved = ctx.ref('sections', sectionKey);
      if (!resolved) {
        errors.push({
          tab: 'fee_structures',
          row: rowNo,
          column: 'section',
          message: `Column "section": no section named "${sectionKey}" was found.`,
          severity: 'error',
          value: sectionKey,
        });
      } else {
        sectionId = resolved;
      }
    }

    const applicability = values.applicability as FeeApplicability;
    const studentKeys = (values.selected_students as string[]) ?? [];
    const studentIds: string[] = [];
    if (applicability === FeeApplicability.SELECTED && studentKeys.length === 0) {
      errors.push({
        tab: 'fee_structures',
        row: rowNo,
        column: 'selected_students',
        message:
          'Column "selected_students": is required when applicability is SELECTED but the cell is empty.',
        severity: 'error',
        value: '',
      });
    }
    for (const key of studentKeys) {
      const resolved = ctx.ref('students', key);
      if (!resolved) {
        errors.push({
          tab: 'fee_structures',
          row: rowNo,
          column: 'selected_students',
          message: `Column "selected_students": no student with registration number "${key}" was found.`,
          severity: 'error',
          value: key,
        });
        continue;
      }
      studentIds.push(resolved);
    }

    if (errors.length > 0) return { errors };

    return {
      row: {
        id: values.id as string,
        name: values.name as string,
        fee_type: values.fee_type as FeeType,
        amount: values.amount as string,
        applicability,
        class_id: classId as string,
        class_key: classKey,
        academic_year_id: academicYearId as string,
        academic_year_key: academicYearKey,
        section_id: sectionId,
        section_key: sectionKey,
        month: values.month as number,
        is_recurring: values.is_recurring as boolean,
        selected_student_ids: studentIds,
        selected_student_keys: studentKeys,
      },
    };
  },

  keyOf(x: FeeStructureRow | FeeStructure): string {
    // Delegates to the referenced tabs' own `keyOf` (same pattern as
    // `sections.tab.ts`) rather than re-deriving their key formats here, so
    // a future change to how `classes` or `academic_years` build their key
    // cannot silently drift out of sync with this tab.
    const classKey =
      x instanceof FeeStructure ? (x.class ? classesTab.keyOf(x.class) : '') : x.class_key;
    const yearKey =
      x instanceof FeeStructure
        ? x.academic_year
          ? academicYearsTab.keyOf(x.academic_year)
          : ''
        : x.academic_year_key;
    const sectionKey =
      x instanceof FeeStructure
        ? x.section
          ? sectionsTab.keyOf(x.section)
          : ''
        : (x.section_key ?? '');
    return `${classKey}|${yearKey}|${sectionKey}|${x.fee_type}|${x.month}|${x.name}`;
  },

  diffFields(row: FeeStructureRow, existing: FeeStructure): string[] {
    const changed: string[] = [];
    if (row.name !== existing.name) changed.push('name');
    if (row.fee_type !== existing.fee_type) changed.push('fee_type');
    if (String(row.amount) !== String(existing.amount)) changed.push('amount');
    if (row.applicability !== existing.applicability) changed.push('applicability');
    if (row.class_id !== existing.class_id) changed.push('class');
    if (row.academic_year_id !== existing.academic_year_id) changed.push('academic_year');
    if (row.section_id !== existing.section_id) changed.push('section');
    if (row.month !== existing.month) changed.push('month');
    if (row.is_recurring !== existing.is_recurring) changed.push('is_recurring');
    const existingStudentIds = (existing.selected_students ?? []).map((l) => l.student_id).sort();
    const rowStudentIds = [...row.selected_student_ids].sort();
    if (JSON.stringify(existingStudentIds) !== JSON.stringify(rowStudentIds)) {
      changed.push('selected_students');
    }
    return changed;
  },

  async upsert(
    row: FeeStructureRow,
    existing: FeeStructure | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<FeeStructure> {
    const structure = existing ?? new FeeStructure();
    structure.tenant_id = tenantId;
    structure.name = row.name;
    structure.fee_type = row.fee_type;
    structure.amount = row.amount as unknown as number;
    structure.applicability = row.applicability;
    structure.class_id = row.class_id;
    structure.section_id = row.section_id;
    structure.academic_year_id = row.academic_year_id;
    structure.month = row.month;
    structure.is_recurring = row.is_recurring;

    const saved = await m.save(FeeStructure, structure);

    // Replace the pivot rows outright: the row's `selected_students` is the
    // full desired set, so a delete-then-recreate is simpler and safer than
    // diffing pivot ids, and this table has no other identity worth keeping.
    await m.delete(FeeStructureStudent, { fee_structure_id: saved.id });
    if (row.selected_student_ids.length > 0) {
      const links = row.selected_student_ids.map((student_id) =>
        m.create(FeeStructureStudent, { fee_structure_id: saved.id, student_id }),
      );
      await m.save(FeeStructureStudent, links);
    }

    return saved;
  },

  async remove(entity: FeeStructure, m: EntityManager): Promise<void> {
    await m.softRemove(FeeStructure, entity);
  },
};
