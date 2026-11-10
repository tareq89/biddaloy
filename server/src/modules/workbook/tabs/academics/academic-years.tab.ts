import type { EntityManager } from 'typeorm';
import { AcademicYear } from '../../../academics/entities/academic-year.entity';
import { fromCell, formatDateOnly, formatDateTime } from '../../codec/cell-format';
import { UserTenant } from '../../../auth/entities/user-tenant.entity';
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
  closed_at: string | null;
  closed_by_user_id: string | null;
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
  { key: 'closed_at', type: 'datetime', label: { en: 'Closed at', bn: 'বন্ধ করার সময়' } },
  // Written as the raw user id: the `users` tab is applied after this one, so no natural key
  // can be resolved yet. `upsert` stores NULL when that id is not in the target database.
  { key: 'closed_by_user_id', type: 'uuid', label: { en: 'Closed by', bn: 'বন্ধ করেছেন' } },
];

/**
 * Entity columns deliberately left out of the workbook. Empty: every real
 * `AcademicYear` column (the `tenant_id` FK aside, which is universal) is
 * exported through `columns` above. `tenant` and `closed_by` are relations, not
 * scalar columns (`closed_by` is exported as `closed_by_user_id`), so TypeORM's own metadata never lists them here.
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
      closed_at: entity.closed_at,
      closed_by_user_id: entity.closed_by_user_id,
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

    // The DB CHECK (CHK_academic_years_closed_not_current, D21): a closed year is never current.
    // Fixed text, the submitted value is not echoed (Rule 23).
    if (values.closed_at && values.is_current) {
      errors.push({
        tab: 'academic_years',
        row: rowNo,
        column: 'closed_at',
        message: 'A closed academic year cannot be the current one.',
        severity: 'error',
      });
    }

    if (errors.length > 0) return { errors };

    return {
      row: {
        id: values.id as string,
        name: values.name as string,
        start_date: values.start_date as string,
        end_date: values.end_date as string,
        is_current: values.is_current as boolean,
        closed_at: values.closed_at ? formatDateTime(values.closed_at) : null,
        closed_by_user_id: values.closed_by_user_id as string | null,
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
    const existingClosedAt = existing.closed_at ? formatDateTime(existing.closed_at) : null;
    if (row.closed_at !== existingClosedAt) changed.push('closed_at');
    if (row.closed_by_user_id !== existing.closed_by_user_id) changed.push('closed_by_user_id');
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
    year.closed_at = row.closed_at ? new Date(row.closed_at) : null;
    // An id that is not a member of THIS tenant becomes NULL (never leaks or attaches another tenant's user), not an error (FK would refuse it).
    year.closed_by_user_id =
      row.closed_by_user_id &&
      (await m.existsBy(UserTenant, { user_id: row.closed_by_user_id, tenant_id: tenantId }))
        ? row.closed_by_user_id
        : null;

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
