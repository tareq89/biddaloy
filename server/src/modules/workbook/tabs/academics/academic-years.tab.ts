import type { EntityManager } from 'typeorm';
import { AcademicYear } from '../../../academics/entities/academic-year.entity';
import { fromCell, formatDateOnly } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';

/**
 * Builds a local-midnight `Date` from a `YYYY-MM-DD` string. `new
 * Date('YYYY-MM-DD')` parses as UTC midnight, which a server west of UTC
 * would save as the previous calendar day — the year/month/day constructor
 * always resolves in the local timezone instead.
 */
function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/**
 * The `academic_years` tab: the school calendar periods a tenant defines.
 *
 * Shaped after `tabs/school/school.tab.ts`. No refs here — `school` is the
 * only dependency, and it is implicit (every row belongs to the destination
 * tenant), so it does not appear as a `ref` column.
 */

export interface AcademicYearRow {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  { key: 'name', type: 'string', required: true, label: { en: 'Name', bn: 'নাম' } },
  {
    key: 'start_date',
    type: 'date',
    required: true,
    label: { en: 'Start date', bn: 'শুরুর তারিখ' },
  },
  { key: 'end_date', type: 'date', required: true, label: { en: 'End date', bn: 'শেষের তারিখ' } },
  {
    key: 'is_current',
    type: 'bool',
    required: true,
    label: { en: 'Is current', bn: 'বর্তমান কিনা' },
  },
];

/**
 * Entity columns deliberately left out of the workbook. Empty: every real
 * `AcademicYear` column (the `tenant_id` FK aside, which is universal) is
 * exported through `columns` above. `tenant` itself is a relation, not a
 * scalar column, so TypeORM's own metadata never lists it here.
 */
const excluded: readonly string[] = [];

const MAX_LENGTHS: Record<string, number> = {
  name: 50,
};

export const academicYearsTab: TabSpec<AcademicYear, AcademicYearRow> = {
  name: 'academic_years',
  entity: AcademicYear,
  excluded,
  dependsOn: ['school'],
  columns,
  naturalKey: ['name'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<AcademicYear[]> {
    return m.find(AcademicYear, { where: { tenant_id: tenantId } });
  },

  toRow(entity: AcademicYear, _ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      name: entity.name,
      start_date: entity.start_date,
      end_date: entity.end_date,
      is_current: entity.is_current,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    _ctx: ImportContext,
  ): { row: AcademicYearRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'academic_years', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }

      const limit = MAX_LENGTHS[column.key];
      if (limit !== undefined && typeof result.value === 'string' && result.value.length > limit) {
        errors.push({
          tab: 'academic_years',
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

    return {
      row: {
        id: values.id as string,
        name: values.name as string,
        start_date: values.start_date as string,
        end_date: values.end_date as string,
        is_current: values.is_current as boolean,
      },
    };
  },

  keyOf(x: AcademicYearRow | AcademicYear): string {
    return x.name;
  },

  diffFields(row: AcademicYearRow, existing: AcademicYear): string[] {
    const changed: string[] = [];
    for (const key of ['name', 'is_current'] as const) {
      if (row[key] !== existing[key]) changed.push(key);
    }
    // Dates come off the entity as `Date`, off the row as `YYYY-MM-DD`
    // strings — compare their text form, same as toRow would export it.
    if (row.start_date !== formatDateOnly(existing.start_date)) changed.push('start_date');
    if (row.end_date !== formatDateOnly(existing.end_date)) changed.push('end_date');
    return changed;
  },

  async upsert(
    row: AcademicYearRow,
    existing: AcademicYear | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<AcademicYear> {
    const year = existing ?? new AcademicYear();
    year.tenant_id = tenantId;
    year.name = row.name;
    year.start_date = parseDateOnly(row.start_date);
    year.end_date = parseDateOnly(row.end_date);
    year.is_current = row.is_current;

    // `is_current` is unique-per-tenant (partial unique index on the
    // entity). Clearing the previous current year in the same manager keeps
    // this atomic with the save below, so a restore can never leave two
    // years marked current, or the DB constraint would reject the save.
    if (row.is_current) {
      await m
        .createQueryBuilder()
        .update(AcademicYear)
        .set({ is_current: false })
        .where('tenant_id = :tenantId', { tenantId })
        .andWhere('is_current = true')
        .andWhere(year.id ? 'id != :id' : '1 = 1', year.id ? { id: year.id } : {})
        .execute();
    }

    return m.save(AcademicYear, year);
  },

  async remove(entity: AcademicYear, m: EntityManager): Promise<void> {
    await m.softRemove(AcademicYear, entity);
  },
};
