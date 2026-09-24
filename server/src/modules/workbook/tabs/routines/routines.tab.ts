import type { EntityManager } from 'typeorm';
import { Routine } from '../../../routines/entities/routine.entity';
import { RoutineState } from '@biddaloy/shared';
import { fromCell, formatDateTime } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';

/**
 * The `routines` tab: one timetable document per academic year.
 *
 * `academic_year` is a `ref` column keyed by the year's own natural key
 * (its `name`), matching the DB's own one-routine-per-`(tenant,
 * academic_year)` unique index.
 */

export interface RoutineRow {
  id: string;
  academic_year_id: string;
  academic_year_key: string;
  name: string;
  state: RoutineState;
  published_at: string | null;
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
    key: 'state',
    type: 'enum',
    enumValues: Object.values(RoutineState),
    required: true,
    label: { en: 'State', bn: 'অবস্থা' },
  },
  { key: 'published_at', type: 'datetime', label: { en: 'Published at', bn: 'প্রকাশিত' } },
];

/**
 * Entity columns deliberately left out of the workbook. The completeness
 * gate (`registry.completeness.spec.ts`) fails if a new `Routine` column
 * appears in neither `columns` nor here.
 */
const excluded: readonly string[] = [
  'academic_year_id', // exported instead as the `academic_year` ref column, keyed by the referenced tab's natural key
];

const MAX_LENGTHS: Record<string, number> = { name: 100 };

export const routinesTab: TabSpec<Routine, RoutineRow> = {
  name: 'routines',
  entity: Routine,
  excluded,
  dependsOn: ['academic_years'],
  columns,
  naturalKey: ['academic_year', 'name'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<Routine[]> {
    return m.find(Routine, { where: { tenant_id: tenantId }, relations: ['academic_year'] });
  },

  toRow(entity: Routine, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      academic_year: ctx.keyOf('academic_years', entity.academic_year_id),
      name: entity.name,
      state: entity.state,
      published_at: entity.published_at,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: RoutineRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'routines', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }

      const limit = MAX_LENGTHS[column.key];
      if (limit !== undefined && typeof result.value === 'string' && result.value.length > limit) {
        errors.push({
          tab: 'routines',
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

    const yearKey = values.academic_year as string;
    const yearId = ctx.ref('academic_years', yearKey);
    if (!yearId) {
      errors.push({
        tab: 'routines',
        row: rowNo,
        column: 'academic_year',
        message: `Column "academic_year": no academic year named "${yearKey}" was found.`,
        severity: 'error',
        value: yearKey,
      });
    }

    if (errors.length > 0) return { errors };

    return {
      row: {
        id: values.id as string,
        academic_year_id: yearId as string,
        academic_year_key: yearKey,
        name: values.name as string,
        state: values.state as RoutineState,
        published_at: (values.published_at as string | null) ?? null,
      },
    };
  },

  keyOf(x: RoutineRow | Routine): string {
    const yearKey = x instanceof Routine ? (x.academic_year?.name ?? '') : x.academic_year_key;
    return `${yearKey}|${x.name}`;
  },

  diffFields(row: RoutineRow, existing: Routine): string[] {
    const changed: string[] = [];
    if (row.academic_year_id !== existing.academic_year_id) changed.push('academic_year');
    if (row.name !== existing.name) changed.push('name');
    if (row.state !== existing.state) changed.push('state');
    const existingPublishedAt = existing.published_at
      ? formatDateTime(existing.published_at)
      : null;
    if (row.published_at !== existingPublishedAt) changed.push('published_at');
    return changed;
  },

  async upsert(
    row: RoutineRow,
    existing: Routine | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<Routine> {
    const routine = existing ?? new Routine();
    routine.tenant_id = tenantId;
    routine.academic_year_id = row.academic_year_id;
    routine.name = row.name;
    routine.state = row.state;
    routine.published_at = row.published_at ? new Date(row.published_at) : null;

    return m.save(Routine, routine);
  },

  async remove(entity: Routine, m: EntityManager): Promise<void> {
    await m.softRemove(Routine, entity);
  },
};
