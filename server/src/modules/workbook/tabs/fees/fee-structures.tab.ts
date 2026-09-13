import type { EntityManager } from 'typeorm';
import { FeeStructure } from '../../../fees/entities/fee-structure.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';
import { FeeType } from '@biddaloy/shared';
import { classesTab } from '../academics/classes.tab';
import { academicYearsTab } from '../academics/academic-years.tab';
import { sectionsTab } from '../academics/sections.tab';

/**
 * The `fee_structures` tab: a school's published price list — `name`,
 * `fee_type`, `amount`, `academic_year`, and an optional `class`/`section`
 * label. It no longer decides who gets billed or when.
 *
 * `class`, `academic_year` and `section` are `ref` columns like
 * `sections.tab.ts`; all three are optional now except `academic_year`.
 */

export interface FeeStructureRow {
  id: string;
  name: string;
  fee_type: FeeType;
  amount: string;
  class_id: string | null;
  class_key: string | null;
  academic_year_id: string;
  academic_year_key: string;
  section_id: string | null;
  section_key: string | null;
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
    key: 'class',
    type: 'ref',
    ref: 'classes',
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
  dependsOn: ['classes', 'academic_years', 'sections'],
  columns,
  // `section` belongs in the key: it is nullable and independent of the
  // other fields, so one class/year/type/name can legitimately carry a
  // different amount per section. Without it those rows share a key,
  // `KeyIndex` flags it ambiguous and collapses them to one id, and
  // delete-by-absence then removes the loser. `class` is nullable too now
  // (a school-wide structure), and the same argument applies: a school-wide
  // structure keys as an empty class segment, which is distinct from any
  // class-scoped one, so `class` stays in the key alongside `section`.
  naturalKey: ['class', 'academic_year', 'section', 'fee_type', 'name'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<FeeStructure[]> {
    // `class`, `section` and their own `academic_year` are loaded eagerly so
    // `toRow`/`keyOf` never need a uuid to build a natural key.
    return m.find(FeeStructure, {
      where: { tenant_id: tenantId },
      relations: ['class', 'class.academic_year', 'section', 'academic_year'],
    });
  },

  toRow(entity: FeeStructure, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      name: entity.name,
      fee_type: entity.fee_type,
      amount: entity.amount,
      class: entity.class_id ? ctx.keyOf('classes', entity.class_id) : null,
      academic_year: ctx.keyOf('academic_years', entity.academic_year_id),
      section: entity.section_id ? ctx.keyOf('sections', entity.section_id) : null,
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

    // A present-but-unresolvable class key is still an error; an absent one
    // is now legal (a school-wide structure has no class label).
    let classId: string | null = null;
    const classKey = (values.class as string | null) ?? null;
    if (classKey) {
      const resolved = ctx.ref('classes', classKey);
      if (!resolved) {
        errors.push({
          tab: 'fee_structures',
          row: rowNo,
          column: 'class',
          message: `Column "class": no class named "${classKey}" was found.`,
          severity: 'error',
          value: classKey,
        });
      } else {
        classId = resolved;
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

    if (errors.length > 0) return { errors };

    return {
      row: {
        id: values.id as string,
        name: values.name as string,
        fee_type: values.fee_type as FeeType,
        amount: values.amount as string,
        class_id: classId,
        class_key: classKey || null,
        academic_year_id: academicYearId as string,
        academic_year_key: academicYearKey,
        section_id: sectionId,
        section_key: sectionKey,
      },
    };
  },

  keyOf(x: FeeStructureRow | FeeStructure): string {
    // Delegates to the referenced tabs' own `keyOf` (same pattern as
    // `sections.tab.ts`) rather than re-deriving their key formats here, so
    // a future change to how `classes` or `academic_years` build their key
    // cannot silently drift out of sync with this tab.
    const classKey =
      x instanceof FeeStructure ? (x.class ? classesTab.keyOf(x.class) : '') : (x.class_key ?? '');
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
    return `${classKey}|${yearKey}|${sectionKey}|${x.fee_type}|${x.name}`;
  },

  diffFields(row: FeeStructureRow, existing: FeeStructure): string[] {
    const changed: string[] = [];
    if (row.name !== existing.name) changed.push('name');
    if (row.fee_type !== existing.fee_type) changed.push('fee_type');
    if (String(row.amount) !== String(existing.amount)) changed.push('amount');
    if (row.class_id !== existing.class_id) changed.push('class');
    if (row.academic_year_id !== existing.academic_year_id) changed.push('academic_year');
    if (row.section_id !== existing.section_id) changed.push('section');
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
    structure.class_id = row.class_id;
    structure.section_id = row.section_id;
    structure.academic_year_id = row.academic_year_id;

    return await m.save(FeeStructure, structure);
  },

  async remove(entity: FeeStructure, m: EntityManager): Promise<void> {
    await m.softRemove(FeeStructure, entity);
  },
};
