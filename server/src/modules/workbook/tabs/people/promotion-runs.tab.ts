import type { EntityManager } from 'typeorm';
import { PromotionRunStatus, PlacementAlgorithm } from '@biddaloy/shared';
import { PromotionRun } from '../../../promotions/entities/promotion-run.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';

/**
 * The `promotion_runs` tab: one end-of-year promotion attempt for a source
 * class — `PromotionRun` (788, D12/D16).
 *
 * `exam_ids` (a `uuid[]` on the entity) is exported as a comma-joined string
 * of the referenced `exams` tab's own natural keys, and parsed back the same
 * way on restore — not as the codec's built-in `ref-list` type, which
 * ';'-joins (`cell-format.ts`); this tab deliberately uses ',' instead, same
 * reasoning as `teachers.tab.ts`'s `designations` column.
 *
 * `target_class_id` is nullable (a `null` run graduates the source class out
 * of the school rather than promoting it forward) — exported as an optional
 * ref, an empty cell meaning `null`, same pattern as `enrollments.tab.ts`'s
 * `section`.
 */
export interface PromotionRunRow {
  id: string;
  source_class_id: string;
  source_academic_year_id: string;
  target_academic_year_id: string;
  target_class_id: string | null;
  exam_ids: string[];
  algorithm: PlacementAlgorithm;
  status: PromotionRunStatus;
  refreshed_at: string;
  committed_at: string | null;
  committed_by_user_id: string | null;
  approved_by_user_id: string | null;
  override_count: number;
  created_by_user_id: string;
  // Referenced tabs' own natural-key text, kept beside the resolved ids so
  // `keyOf` builds the same string for a row as for an entity.
  source_class_key: string;
  source_academic_year_key: string;
  target_academic_year_key: string;
  target_class_key: string | null;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  {
    key: 'source_class',
    type: 'ref',
    ref: 'classes',
    required: true,
    label: { en: 'Source class', bn: 'উৎস শ্রেণী' },
  },
  {
    key: 'source_academic_year',
    type: 'ref',
    ref: 'academic_years',
    required: true,
    label: { en: 'Source academic year', bn: 'উৎস শিক্ষাবর্ষ' },
  },
  {
    key: 'target_academic_year',
    type: 'ref',
    ref: 'academic_years',
    required: true,
    label: { en: 'Target academic year', bn: 'লক্ষ্য শিক্ষাবর্ষ' },
  },
  {
    // Optional: `null` graduates the source class out of the school (D13).
    key: 'target_class',
    type: 'ref',
    ref: 'classes',
    label: { en: 'Target class', bn: 'লক্ষ্য শ্রেণী' },
  },
  {
    // Comma-joined `exams` natural keys — see docstring for why this is a
    // plain `string` column rather than the built-in `ref-list` type.
    key: 'exams',
    type: 'string',
    required: true,
    label: { en: 'Exams', bn: 'পরীক্ষা' },
  },
  {
    key: 'algorithm',
    type: 'enum',
    enumValues: Object.values(PlacementAlgorithm),
    required: true,
    label: { en: 'Algorithm', bn: 'অ্যালগরিদম' },
  },
  {
    key: 'status',
    type: 'enum',
    enumValues: Object.values(PromotionRunStatus),
    required: true,
    label: { en: 'Status', bn: 'অবস্থা' },
  },
  {
    key: 'refreshed_at',
    type: 'datetime',
    required: true,
    label: { en: 'Refreshed at', bn: 'সতেজ করার সময়' },
  },
  {
    key: 'committed_at',
    type: 'datetime',
    label: { en: 'Committed at', bn: 'নিশ্চিতকরণের সময়' },
  },
  {
    key: 'committed_by',
    type: 'uuid',
    label: { en: 'Committed by (user id)', bn: 'নিশ্চিতকারী (ইউজার আইডি)' },
  },
  {
    key: 'approved_by',
    type: 'uuid',
    label: { en: 'Approved by (user id)', bn: 'অনুমোদনকারী (ইউজার আইডি)' },
  },
  {
    key: 'override_count',
    type: 'int',
    required: true,
    label: { en: 'Override count', bn: 'ওভাররাইড সংখ্যা' },
  },
  {
    key: 'created_by',
    type: 'uuid',
    required: true,
    label: { en: 'Created by (user id)', bn: 'তৈরিকারী (ইউজার আইডি)' },
  },
];

/**
 * `PromotionRun` columns deliberately left out of the workbook. The
 * completeness gate (`registry.completeness.spec.ts`) fails if a new
 * `PromotionRun` column appears in neither `columns` nor here.
 */
const excluded: readonly string[] = [
  'source_class_id', // exported instead as the `source_class` ref column
  'source_academic_year_id', // exported instead as the `source_academic_year` ref column
  'target_academic_year_id', // exported instead as the `target_academic_year` ref column
  'target_class_id', // exported instead as the `target_class` ref column
  'exam_ids', // exported instead as the comma-joined `exams` column (see docstring)
  'committed_by_user_id', // exported instead as the `committed_by` uuid column, not resolved via a `users` ref: a user's own natural key round-trips through the `users` tab already, and this is just bookkeeping about *who*, not a relation another tab keys against
  'approved_by_user_id', // same as committed_by_user_id
  'created_by_user_id', // same as committed_by_user_id
];

export const promotionRunsTab: TabSpec<PromotionRun, PromotionRunRow> = {
  name: 'promotion_runs',
  entity: PromotionRun,
  excluded,
  dependsOn: ['classes', 'academic_years', 'exams'],
  columns,
  // The natural composite (source_class, target_academic_year) is only
  // DB-unique for status='COMMITTED' (a partial unique index) — two DRAFT
  // runs, or a DRAFT alongside a COMMITTED run, for the same class+target
  // year would collide on that key and corrupt restore. `id` is always
  // unique regardless of status, so `keyOf` below uses it directly.
  naturalKey: ['id'],
  deleteByAbsence: true,

  async load(tenantId: string, m: EntityManager): Promise<PromotionRun[]> {
    return m.find(PromotionRun, { where: { tenant_id: tenantId } });
  },

  toRow(entity: PromotionRun, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      source_class: ctx.keyOf('classes', entity.source_class_id),
      source_academic_year: ctx.keyOf('academic_years', entity.source_academic_year_id),
      target_academic_year: ctx.keyOf('academic_years', entity.target_academic_year_id),
      target_class: entity.target_class_id ? ctx.keyOf('classes', entity.target_class_id) : null,
      exams: entity.exam_ids.map((examId) => ctx.keyOf('exams', examId)).join(','),
      algorithm: entity.algorithm,
      status: entity.status,
      refreshed_at: entity.refreshed_at,
      committed_at: entity.committed_at,
      committed_by: entity.committed_by_user_id,
      approved_by: entity.approved_by_user_id,
      override_count: entity.override_count,
      created_by: entity.created_by_user_id,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: PromotionRunRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'promotion_runs', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }
      values[column.key] = result.value;
    }

    if (errors.length > 0) return { errors };

    const sourceClassKey = values.source_class as string;
    const sourceClassId = sourceClassKey ? ctx.ref('classes', sourceClassKey) : undefined;
    if (sourceClassKey && !sourceClassId) {
      errors.push({
        tab: 'promotion_runs',
        row: rowNo,
        column: 'source_class',
        message: `Column "source_class": no class named "${sourceClassKey}" was found.`,
        severity: 'error',
        value: sourceClassKey,
      });
    }

    const sourceYearKey = values.source_academic_year as string;
    const sourceYearId = sourceYearKey ? ctx.ref('academic_years', sourceYearKey) : undefined;
    if (sourceYearKey && !sourceYearId) {
      errors.push({
        tab: 'promotion_runs',
        row: rowNo,
        column: 'source_academic_year',
        message: `Column "source_academic_year": no academic year named "${sourceYearKey}" was found.`,
        severity: 'error',
        value: sourceYearKey,
      });
    }

    const targetYearKey = values.target_academic_year as string;
    const targetYearId = targetYearKey ? ctx.ref('academic_years', targetYearKey) : undefined;
    if (targetYearKey && !targetYearId) {
      errors.push({
        tab: 'promotion_runs',
        row: rowNo,
        column: 'target_academic_year',
        message: `Column "target_academic_year": no academic year named "${targetYearKey}" was found.`,
        severity: 'error',
        value: targetYearKey,
      });
    }

    // `target_class` is the only optional ref: an empty cell means
    // `target_class_id: null` (this run graduates the class out, D13).
    const targetClassKey = (values.target_class as string | null) ?? '';
    let targetClassId: string | null = null;
    if (targetClassKey) {
      const resolved = ctx.ref('classes', targetClassKey);
      if (!resolved) {
        errors.push({
          tab: 'promotion_runs',
          row: rowNo,
          column: 'target_class',
          message: `Column "target_class": no class named "${targetClassKey}" was found.`,
          severity: 'error',
          value: targetClassKey,
        });
      } else {
        targetClassId = resolved;
      }
    }

    const examsText = (values.exams as string | null) ?? '';
    const examKeys = examsText
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k !== '');
    const examIds: string[] = [];
    for (const examKey of examKeys) {
      const resolved = ctx.ref('exams', examKey);
      if (!resolved) {
        errors.push({
          tab: 'promotion_runs',
          row: rowNo,
          column: 'exams',
          message: `Column "exams": no exam "${examKey}" was found.`,
          severity: 'error',
          value: examsText,
        });
        continue;
      }
      examIds.push(resolved);
    }

    if (errors.length > 0) return { errors };

    return {
      row: {
        id: values.id as string,
        source_class_id: sourceClassId as string,
        source_academic_year_id: sourceYearId as string,
        target_academic_year_id: targetYearId as string,
        target_class_id: targetClassId,
        exam_ids: examIds,
        algorithm: values.algorithm as PlacementAlgorithm,
        status: values.status as PromotionRunStatus,
        refreshed_at: values.refreshed_at as string,
        committed_at: (values.committed_at as string | null) ?? null,
        committed_by_user_id: (values.committed_by as string | null) ?? null,
        approved_by_user_id: (values.approved_by as string | null) ?? null,
        override_count: values.override_count as number,
        created_by_user_id: values.created_by as string,
        source_class_key: sourceClassKey,
        source_academic_year_key: sourceYearKey,
        target_academic_year_key: targetYearKey,
        target_class_key: targetClassKey ? targetClassKey : null,
      },
    };
  },

  keyOf(x: PromotionRunRow | PromotionRun): string {
    return x.id;
  },

  diffFields(row: PromotionRunRow, existing: PromotionRun): string[] {
    const changed: string[] = [];
    if (row.source_class_id !== existing.source_class_id) changed.push('source_class');
    if (row.source_academic_year_id !== existing.source_academic_year_id) {
      changed.push('source_academic_year');
    }
    if (row.target_academic_year_id !== existing.target_academic_year_id) {
      changed.push('target_academic_year');
    }
    if ((row.target_class_id ?? null) !== (existing.target_class_id ?? null)) {
      changed.push('target_class');
    }
    const rowExamIds = [...row.exam_ids].sort().join(',');
    const existingExamIds = [...(existing.exam_ids ?? [])].sort().join(',');
    if (rowExamIds !== existingExamIds) changed.push('exams');
    if (row.algorithm !== existing.algorithm) changed.push('algorithm');
    if (row.status !== existing.status) changed.push('status');
    if (new Date(existing.refreshed_at).toISOString() !== row.refreshed_at) {
      changed.push('refreshed_at');
    }
    const rowCommittedAt = row.committed_at;
    const existingCommittedAt = existing.committed_at ? existing.committed_at.toISOString() : null;
    if (rowCommittedAt !== existingCommittedAt) changed.push('committed_at');
    if ((row.committed_by_user_id ?? null) !== (existing.committed_by_user_id ?? null)) {
      changed.push('committed_by');
    }
    if ((row.approved_by_user_id ?? null) !== (existing.approved_by_user_id ?? null)) {
      changed.push('approved_by');
    }
    if (row.override_count !== existing.override_count) changed.push('override_count');
    if (row.created_by_user_id !== existing.created_by_user_id) changed.push('created_by');
    return changed;
  },

  async upsert(
    row: PromotionRunRow,
    existing: PromotionRun | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<PromotionRun> {
    const run = existing ?? new PromotionRun();
    // `keyOf` is `id` (see its docstring) — a fresh insert on restore must
    // reuse the workbook's own id, because `promotion_entries` exports its
    // `run` column as this raw uuid; keeping the id stable across restore
    // is what lets that export round-trip back to the same row.
    if (!existing) {
      // `existing` comes from a tenant-scoped `load()`, so a row already
      // owned by ANOTHER tenant also resolves `existing === null` here.
      // Guard against that before reusing `row.id`, or `m.save()` below
      // would UPDATE the other tenant's row (TypeORM saves an entity with
      // a set primary key by upsert-on-PK, no tenant filter) — same
      // cross-tenant takeover hazard as `students.tab.ts`.
      const holder = await m.findOne(PromotionRun, {
        where: { id: row.id },
        withDeleted: true,
      });
      if (holder && holder.tenant_id !== tenantId) {
        throw new Error(
          `Promotion run "${row.id}" already exists in tenant "${holder.tenant_id}" ` +
            `and cannot be restored into tenant "${tenantId}".`,
        );
      }
      run.id = row.id;
    }

    run.tenant_id = tenantId;
    run.source_class_id = row.source_class_id;
    run.source_academic_year_id = row.source_academic_year_id;
    run.target_academic_year_id = row.target_academic_year_id;
    run.target_class_id = row.target_class_id;
    run.exam_ids = row.exam_ids;
    run.algorithm = row.algorithm;
    run.status = row.status;
    run.refreshed_at = new Date(row.refreshed_at);
    run.committed_at = row.committed_at ? new Date(row.committed_at) : null;
    run.committed_by_user_id = row.committed_by_user_id;
    run.approved_by_user_id = row.approved_by_user_id;
    run.override_count = row.override_count;
    run.created_by_user_id = row.created_by_user_id;

    return m.save(PromotionRun, run);
  },

  async remove(entity: PromotionRun, m: EntityManager): Promise<void> {
    // Hard delete: the entity has no `deleted_at` — drafts (and, on
    // restore, any run absent from the workbook) are discarded outright
    // (D24), matching `enrollments.tab.ts`'s reasoning for its own
    // hard-deleted entity.
    await m.remove(PromotionRun, entity);
  },
};
