import type { EntityManager } from 'typeorm';
import { SchoolHoliday } from '../../../academics/entities/school-holiday.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';

/**
 * The `holidays` tab: `SchoolHoliday` calendar entries (holidays, exams,
 * events) that [9.4]'s working-day math reads.
 *
 * `academic_year` is the only `ref` column: the cell holds the referenced
 * academic year's own name, not a raw id.
 */

export interface HolidayRow {
  id: string;
  academic_year_id: string;
  name: string;
  start_date: string;
  end_date: string;
  counts_as_working_day: boolean;
  // The academic year's own natural key, kept alongside the resolved local
  // id so `keyOf` can build the same key format for both a freshly-imported
  // row and an existing entity, without a uuid ever appearing in a natural
  // key.
  academic_year_key: string;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  {
    key: 'academic_year',
    type: 'ref',
    ref: 'academic_years',
    required: true,
    label: { en: 'Academic year', bn: 'শিক্ষাবর্ষ' },
  },
  { key: 'name', type: 'string', required: true, label: { en: 'Name', bn: 'নাম' } },
  {
    key: 'start_date',
    type: 'date',
    required: true,
    label: { en: 'Start date', bn: 'শুরুর তারিখ' },
  },
  { key: 'end_date', type: 'date', required: true, label: { en: 'End date', bn: 'শেষের তারিখ' } },
  {
    key: 'counts_as_working_day',
    type: 'bool',
    required: true,
    label: { en: 'Counts as working day', bn: 'কার্যদিবস হিসেবে গণনা' },
  },
];

/**
 * Entity columns deliberately left out of the workbook. The completeness
 * gate (`registry.completeness.spec.ts`) fails if a new `SchoolHoliday`
 * column appears in neither `columns` nor here.
 */
const excluded: readonly string[] = [
  'academic_year_id', // exported instead as the `academic_year` ref column, keyed by the referenced tab's natural key
];

const MAX_LENGTHS: Record<string, number> = {
  name: 120,
};

export const holidaysTab: TabSpec<SchoolHoliday, HolidayRow> = {
  name: 'holidays',
  entity: SchoolHoliday,
  excluded,
  dependsOn: ['academic_years'],
  columns,
  naturalKey: ['academic_year', 'name', 'start_date'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<SchoolHoliday[]> {
    // `academic_year` is loaded eagerly: `keyOf` needs the year's own name
    // (its natural key), never its uuid, since a natural key must stay
    // portable across tenants.
    return m.find(SchoolHoliday, {
      where: { tenant_id: tenantId },
      relations: ['academic_year'],
    });
  },

  toRow(entity: SchoolHoliday, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      academic_year: ctx.keyOf('academic_years', entity.academic_year_id),
      name: entity.name,
      start_date: entity.start_date,
      end_date: entity.end_date,
      counts_as_working_day: entity.counts_as_working_day,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: HolidayRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'holidays', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }

      const limit = MAX_LENGTHS[column.key];
      if (limit !== undefined && typeof result.value === 'string' && result.value.length > limit) {
        errors.push({
          tab: 'holidays',
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
          tab: 'holidays',
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
        academic_year_id: academicYearId as string,
        name: values.name as string,
        start_date: values.start_date as string,
        end_date: values.end_date as string,
        counts_as_working_day: values.counts_as_working_day as boolean,
        academic_year_key: academicYearKey,
      },
    };
  },

  keyOf(x: HolidayRow | SchoolHoliday): string {
    // A natural key is never a uuid (see key-index.ts): a row carries the
    // year's key text directly, an entity must read it off the (eagerly
    // loaded) `academic_year` relation.
    const yearKey =
      x instanceof SchoolHoliday ? (x.academic_year?.name ?? '') : x.academic_year_key;
    return `${yearKey}|${x.name}|${formatDateOnly(x.start_date)}`;
  },

  diffFields(row: HolidayRow, existing: SchoolHoliday): string[] {
    const changed: string[] = [];
    if (row.academic_year_id !== existing.academic_year_id) changed.push('academic_year');
    if (row.name !== existing.name) changed.push('name');
    if (row.start_date !== formatDateOnly(existing.start_date)) changed.push('start_date');
    if (row.end_date !== formatDateOnly(existing.end_date)) changed.push('end_date');
    if (row.counts_as_working_day !== existing.counts_as_working_day) {
      changed.push('counts_as_working_day');
    }
    return changed;
  },

  async upsert(
    row: HolidayRow,
    existing: SchoolHoliday | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<SchoolHoliday> {
    const holiday = existing ?? new SchoolHoliday();
    holiday.tenant_id = tenantId;
    holiday.academic_year_id = row.academic_year_id;
    holiday.name = row.name;
    holiday.start_date = row.start_date;
    holiday.end_date = row.end_date;
    holiday.counts_as_working_day = row.counts_as_working_day;

    return m.save(SchoolHoliday, holiday);
  },

  async remove(entity: SchoolHoliday, m: EntityManager): Promise<void> {
    await m.softRemove(SchoolHoliday, entity);
  },
};

/**
 * Mirrors `academic-years.tab.ts`'s `formatDateOnly` for the local-calendar-
 * day comparison in `diffFields`/`keyOf`. TypeORM hands a Postgres `date`
 * column back as a plain `YYYY-MM-DD` string (no time, no timezone), which
 * is read straight through here for the same reason `cell-format.ts` does:
 * routing it through `new Date(...)` and back would risk a UTC/local day
 * shift.
 */
function formatDateOnly(value: Date | string): string {
  if (typeof value === 'string') return value.slice(0, 10);
  const year = String(value.getFullYear()).padStart(4, '0');
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
