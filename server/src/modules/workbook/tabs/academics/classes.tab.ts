import type { EntityManager } from 'typeorm';
import { Class } from '../../../academics/entities/class.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';

/**
 * The `classes` tab: grades/standards within an academic year.
 *
 * `academic_year` is a `ref` column: the cell holds the referenced academic
 * year's natural key (its `name`), not a raw id, so the workbook stays
 * readable and portable across tenants. `numeric_grade` is dropped — see
 * `excluded` below.
 */

export interface ClassRow {
  id: string;
  name: string;
  academic_year_id: string;
  // The academic year's own natural key (its `name`), kept alongside the
  // resolved local id so `keyOf` can build the same key format for both a
  // freshly-imported row and an existing entity, without a uuid ever
  // appearing in a natural key (see key-index.ts).
  academic_year_key: string;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  { key: 'name', type: 'string', required: true, label: { en: 'Name', bn: 'নাম' } },
  {
    key: 'academic_year',
    type: 'ref',
    ref: 'academic_years',
    required: true,
    label: { en: 'Academic year', bn: 'শিক্ষাবর্ষ' },
  },
];

/**
 * Entity columns deliberately left out of the workbook. The completeness
 * gate (`registry.completeness.spec.ts`) fails if a new `Class` column
 * appears in neither `columns` nor here.
 */
const excluded: readonly string[] = [
  'numeric_grade', // display-sort hint only; not in the ticket's column list and derivable from `name` if ever needed
  'academic_year_id', // exported instead as the `academic_year` ref column, keyed by the referenced tab's natural key
];

const MAX_LENGTHS: Record<string, number> = {
  name: 50,
};

export const classesTab: TabSpec<Class, ClassRow> = {
  name: 'classes',
  entity: Class,
  excluded,
  dependsOn: ['academic_years'],
  columns,
  naturalKey: ['name', 'academic_year'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<Class[]> {
    // `academic_year` is loaded eagerly: `keyOf` needs the year's own name
    // (its natural key), never its uuid, since a natural key must stay
    // portable across tenants.
    return m.find(Class, { where: { tenant_id: tenantId }, relations: ['academic_year'] });
  },

  toRow(entity: Class, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      name: entity.name,
      academic_year: ctx.keyOf('academic_years', entity.academic_year_id),
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: ClassRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'classes', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }

      const limit = MAX_LENGTHS[column.key];
      if (limit !== undefined && typeof result.value === 'string' && result.value.length > limit) {
        errors.push({
          tab: 'classes',
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

    let academicYearId: string | undefined;
    const academicYearKey = values.academic_year as string;
    if (academicYearKey) {
      academicYearId = ctx.ref('academic_years', academicYearKey);
      if (!academicYearId) {
        errors.push({
          tab: 'classes',
          row: rowNo,
          column: 'academic_year',
          message: `Column "academic_year": no academic year named "${academicYearKey}" was found.`,
          severity: 'error',
          value: academicYearKey,
        });
      }
    }

    if (errors.length > 0) return { errors };

    return {
      row: {
        id: values.id as string,
        name: values.name as string,
        academic_year_id: academicYearId as string,
        academic_year_key: academicYearKey,
      },
    };
  },

  keyOf(x: ClassRow | Class): string {
    // A natural key is never a uuid (see key-index.ts): a row carries the
    // year's key text directly, an entity must read it off the (eagerly
    // loaded) `academic_year` relation.
    const yearKey = x instanceof Class ? (x.academic_year?.name ?? '') : x.academic_year_key;
    return `${x.name}|${yearKey}`;
  },

  diffFields(row: ClassRow, existing: Class): string[] {
    const changed: string[] = [];
    if (row.name !== existing.name) changed.push('name');
    if (row.academic_year_id !== existing.academic_year_id) changed.push('academic_year');
    return changed;
  },

  async upsert(
    row: ClassRow,
    existing: Class | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<Class> {
    const klass = existing ?? new Class();
    klass.tenant_id = tenantId;
    klass.name = row.name;
    klass.academic_year_id = row.academic_year_id;

    return m.save(Class, klass);
  },

  async remove(entity: Class, m: EntityManager): Promise<void> {
    await m.softRemove(Class, entity);
  },
};
