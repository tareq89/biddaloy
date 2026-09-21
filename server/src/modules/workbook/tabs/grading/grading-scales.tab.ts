import type { EntityManager } from 'typeorm';
import { GradingScale } from '../../../grading/entities/grading-scale.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';
import { classesTab } from '../academics/classes.tab';

/**
 * The `grading_scales` tab: a school's set of grading scales, one per
 * academic year (the default, `class` empty) plus any per-class overrides.
 *
 * `class` is an optional `ref` column, same pattern `fee_structures.tab.ts`
 * uses for its own optional `class`/`section`: an empty cell means "this
 * year's default scale" (D1), a filled one means a per-class override.
 *
 * `revision` is exported and restored as a plain column, not excluded — a
 * scale's bands may be edited after results have been computed against it,
 * bumping `revision` so those results stay readable against the band set
 * that actually produced them. A restore that silently reset `revision` to
 * 1 would break that pin (D6), so this tab writes the value back exactly on
 * both create and update rather than letting the entity default apply.
 */

export interface GradingScaleRow {
  id: string;
  name: string;
  academic_year_id: string;
  academic_year_key: string;
  class_id: string | null;
  class_key: string | null;
  revision: number;
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
  {
    key: 'class',
    type: 'ref',
    ref: 'classes',
    label: { en: 'Class (override)', bn: 'শ্রেণী (ওভাররাইড)' },
  },
  { key: 'revision', type: 'int', required: true, label: { en: 'Revision', bn: 'সংশোধন' } },
];

const excluded: readonly string[] = [
  'academic_year_id', // exported instead as the `academic_year` ref column
  'class_id', // exported instead as the `class` ref column
];

const MAX_LENGTHS: Record<string, number> = {
  name: 200,
};

export const gradingScalesTab: TabSpec<GradingScale, GradingScaleRow> = {
  name: 'grading_scales',
  entity: GradingScale,
  excluded,
  dependsOn: ['academic_years', 'classes'],
  // `class` is part of the key: it is nullable and independent of the other
  // fields, so a year-default scale and a class-override scale can share a
  // `name` without colliding. See `fee_structures.tab.ts` for the same
  // reasoning on its own optional `class`/`section` key columns.
  columns,
  naturalKey: ['name', 'academic_year', 'class'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<GradingScale[]> {
    return m.find(GradingScale, {
      where: { tenant_id: tenantId },
      relations: ['academic_year', 'class', 'class.academic_year'],
    });
  },

  toRow(entity: GradingScale, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      name: entity.name,
      academic_year: ctx.keyOf('academic_years', entity.academic_year_id),
      class: entity.class_id ? ctx.keyOf('classes', entity.class_id) : null,
      revision: entity.revision,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: GradingScaleRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'grading_scales', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }

      const limit = MAX_LENGTHS[column.key];
      if (limit !== undefined && typeof result.value === 'string' && result.value.length > limit) {
        errors.push({
          tab: 'grading_scales',
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
          tab: 'grading_scales',
          row: rowNo,
          column: 'academic_year',
          message: `Column "academic_year": no academic year named "${academicYearKey}" was found.`,
          severity: 'error',
          value: academicYearKey,
        });
      }
    }

    let classId: string | null = null;
    const classKey = (values.class as string | null) ?? null;
    if (classKey) {
      const resolved = ctx.ref('classes', classKey);
      if (!resolved) {
        errors.push({
          tab: 'grading_scales',
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

    if (errors.length > 0) return { errors };

    // `classKey` embeds its own academic year (`classesTab.keyOf` builds it
    // as `${name}|${yearKey}`) — reject a row whose separately given
    // `academic_year` names a different year, since persistence saves both
    // `class_id` and `academic_year_id` and would otherwise store two
    // contradictory foreign keys. Same invariant as `classSubjectsTab`.
    if (classKey) {
      const classYearKey = classKey.slice(classKey.indexOf('|') + 1);
      if (classYearKey !== academicYearKey) {
        return {
          errors: [
            {
              tab: 'grading_scales',
              row: rowNo,
              column: 'academic_year',
              message: `Column "academic_year": "${academicYearKey}" does not match the academic year of class "${classKey}".`,
              severity: 'error',
              value: academicYearKey,
            },
          ],
        };
      }
    }

    return {
      row: {
        id: values.id as string,
        name: values.name as string,
        academic_year_id: academicYearId as string,
        academic_year_key: academicYearKey,
        class_id: classId,
        class_key: classKey,
        revision: values.revision as number,
      },
    };
  },

  keyOf(x: GradingScaleRow | GradingScale): string {
    const yearKey = x instanceof GradingScale ? (x.academic_year?.name ?? '') : x.academic_year_key;
    const classKey =
      x instanceof GradingScale ? (x.class ? classesTab.keyOf(x.class) : '') : (x.class_key ?? '');
    return `${x.name}|${yearKey}|${classKey}`;
  },

  diffFields(row: GradingScaleRow, existing: GradingScale): string[] {
    const changed: string[] = [];
    if (row.name !== existing.name) changed.push('name');
    if (row.academic_year_id !== existing.academic_year_id) changed.push('academic_year');
    if (row.class_id !== existing.class_id) changed.push('class');
    if (row.revision !== existing.revision) changed.push('revision');
    return changed;
  },

  async upsert(
    row: GradingScaleRow,
    existing: GradingScale | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<GradingScale> {
    const scale = existing ?? new GradingScale();
    scale.tenant_id = tenantId;
    scale.name = row.name;
    scale.academic_year_id = row.academic_year_id;
    scale.class_id = row.class_id;
    // Written explicitly on both create and update: the entity's `default: 1`
    // must never silently override a restored value above 1 (D6).
    scale.revision = row.revision;

    return m.save(GradingScale, scale);
  },

  async remove(entity: GradingScale, m: EntityManager): Promise<void> {
    await m.softRemove(GradingScale, entity);
  },
};
