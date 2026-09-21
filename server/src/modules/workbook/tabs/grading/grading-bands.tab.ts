import type { EntityManager } from 'typeorm';
import { GradingBand } from '../../../grading/entities/grading-band.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';
import { gradingScalesTab } from './grading-scales.tab';

/**
 * The `grading_bands` tab: one percent-range band within a `grading_scales`
 * row — e.g. "80-100% -> A+, GPA 5.0".
 *
 * `gpa` is a nullable `money` column (D4): it is a plain decimal string,
 * same shape a real money amount is, so the existing decimal-string
 * formatting in `cell-format.ts` already round-trips it without precision
 * loss — reusing `money` rather than inventing a `decimal` column type.
 * Some scales grade with letters only and never compute a GPA, so an empty
 * cell must stay `null`, not `0.00`.
 */

export interface GradingBandRow {
  id: string;
  scale_id: string;
  scale_key: string;
  percent_from: number;
  percent_to: number;
  grade: string;
  gpa: string | null;
  is_fail: boolean;
  sequence: number;
  comment: string | null;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  {
    key: 'scale',
    type: 'ref',
    ref: 'grading_scales',
    required: true,
    label: { en: 'Scale', bn: 'স্কেল' },
  },
  {
    key: 'percent_from',
    type: 'int',
    required: true,
    label: { en: 'Percent from', bn: 'শতাংশ থেকে' },
  },
  {
    key: 'percent_to',
    type: 'int',
    required: true,
    label: { en: 'Percent to', bn: 'শতাংশ পর্যন্ত' },
  },
  { key: 'grade', type: 'string', required: true, label: { en: 'Grade', bn: 'গ্রেড' } },
  { key: 'gpa', type: 'money', label: { en: 'GPA', bn: 'জিপিএ' } },
  { key: 'is_fail', type: 'bool', required: true, label: { en: 'Is fail', bn: 'অকৃতকার্য' } },
  { key: 'sequence', type: 'int', required: true, label: { en: 'Sequence', bn: 'ক্রম' } },
  { key: 'comment', type: 'string', label: { en: 'Comment', bn: 'মন্তব্য' } },
];

const excluded: readonly string[] = [
  'scale_id', // exported instead as the `scale` ref column
];

const MAX_LENGTHS: Record<string, number> = {
  grade: 10,
};

export const gradingBandsTab: TabSpec<GradingBand, GradingBandRow> = {
  name: 'grading_bands',
  entity: GradingBand,
  excluded,
  dependsOn: ['grading_scales'],
  // `sequence` is unique per scale (the entity's own partial unique index),
  // so `scale|sequence` is a stable key even across an edit that changes
  // every other column on the row.
  columns,
  naturalKey: ['scale', 'sequence'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<GradingBand[]> {
    // `scale`'s own `academic_year`/`class` are loaded eagerly so
    // `gradingScalesTab.keyOf` (delegated to below) never needs a uuid.
    return m.find(GradingBand, {
      where: { tenant_id: tenantId },
      relations: ['scale', 'scale.academic_year', 'scale.class', 'scale.class.academic_year'],
    });
  },

  toRow(entity: GradingBand, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      scale: ctx.keyOf('grading_scales', entity.scale_id),
      percent_from: entity.percent_from,
      percent_to: entity.percent_to,
      grade: entity.grade,
      gpa: entity.gpa,
      is_fail: entity.is_fail,
      sequence: entity.sequence,
      comment: entity.comment,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: GradingBandRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'grading_bands', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }

      const limit = MAX_LENGTHS[column.key];
      if (limit !== undefined && typeof result.value === 'string' && result.value.length > limit) {
        errors.push({
          tab: 'grading_bands',
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

    let scaleId: string | undefined;
    const scaleKey = values.scale as string;
    if (scaleKey) {
      scaleId = ctx.ref('grading_scales', scaleKey);
      if (!scaleId) {
        errors.push({
          tab: 'grading_bands',
          row: rowNo,
          column: 'scale',
          message: `Column "scale": no grading scale "${scaleKey}" was found.`,
          severity: 'error',
          value: scaleKey,
        });
      }
    }

    if (errors.length > 0) return { errors };

    return {
      row: {
        id: values.id as string,
        scale_id: scaleId as string,
        scale_key: scaleKey,
        percent_from: values.percent_from as number,
        percent_to: values.percent_to as number,
        grade: values.grade as string,
        gpa: (values.gpa as string | null) ?? null,
        is_fail: values.is_fail as boolean,
        sequence: values.sequence as number,
        comment: (values.comment as string | null) ?? null,
      },
    };
  },

  keyOf(x: GradingBandRow | GradingBand): string {
    const scaleKey =
      x instanceof GradingBand ? (x.scale ? gradingScalesTab.keyOf(x.scale) : '') : x.scale_key;
    return `${scaleKey}|${x.sequence}`;
  },

  diffFields(row: GradingBandRow, existing: GradingBand): string[] {
    const changed: string[] = [];
    if (row.scale_id !== existing.scale_id) changed.push('scale');
    if (row.percent_from !== existing.percent_from) changed.push('percent_from');
    if (row.percent_to !== existing.percent_to) changed.push('percent_to');
    if (row.grade !== existing.grade) changed.push('grade');
    if (String(row.gpa ?? '') !== String(existing.gpa ?? '')) changed.push('gpa');
    if (row.is_fail !== existing.is_fail) changed.push('is_fail');
    if (row.sequence !== existing.sequence) changed.push('sequence');
    if (row.comment !== existing.comment) changed.push('comment');
    return changed;
  },

  async upsert(
    row: GradingBandRow,
    existing: GradingBand | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<GradingBand> {
    const band = existing ?? new GradingBand();
    band.tenant_id = tenantId;
    band.scale_id = row.scale_id;
    band.percent_from = row.percent_from;
    band.percent_to = row.percent_to;
    band.grade = row.grade;
    band.gpa = row.gpa;
    band.is_fail = row.is_fail;
    band.sequence = row.sequence;
    band.comment = row.comment;

    return m.save(GradingBand, band);
  },

  async remove(entity: GradingBand, m: EntityManager): Promise<void> {
    await m.softRemove(GradingBand, entity);
  },
};
