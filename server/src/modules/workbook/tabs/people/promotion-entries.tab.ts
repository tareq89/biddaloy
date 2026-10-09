import { In } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { PromotionOutcome } from '@biddaloy/shared';
import { PromotionEntry } from '../../../promotions/entities/promotion-entry.entity';
import { Student } from '../../../students/entities/student.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';

/**
 * The `promotion_entries` tab: one student's decision within a
 * `PromotionRun` — `PromotionEntry` (788, D6/D11/D12/D16).
 *
 * `is_override = true` requires a non-blank `override_note` — a DB CHECK on
 * the entity (`CHK_promotion_entries_override_note`). `fromRow` mirrors that
 * check on restore, the same way `promotion-run.tab.ts`'s sibling tab
 * mirrors its own entity's invariants, so a bad workbook row fails as one
 * `RowError` here rather than as an opaque Postgres 23514 that aborts the
 * whole restore.
 *
 * Registered after both `enrollments` (for `source_enrollment_id`) and
 * `promotion_runs` (for `run_id`) — the ticket's "entries reference both".
 */
export interface PromotionEntryRow {
  id: string;
  run_id: string;
  student_id: string;
  source_enrollment_id: string;
  source_section_id: string | null;
  merit_rank: number | null;
  mean_gpa: string | null;
  total_marks_sum: string | null;
  passed_all: boolean;
  suggested_outcome: PromotionOutcome;
  final_outcome: PromotionOutcome;
  is_override: boolean;
  override_note: string | null;
  overridden_by_user_id: string | null;
  group_name: string | null;
  target_class_id: string | null;
  target_section_id: string | null;
  new_roll_number: number | null;
  placement_error: string | null;
  target_enrollment_id: string | null;
  // Referenced tab's own natural-key text; `keyOf` reads this for the
  // student half of its key (the run half uses `run_id` directly, see
  // `keyOf`'s comment).
  student_key: string;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  {
    key: 'run',
    type: 'ref',
    ref: 'promotion_runs',
    required: true,
    label: { en: 'Promotion run', bn: 'প্রমোশন রান' },
  },
  {
    key: 'student',
    type: 'ref',
    ref: 'students',
    required: true,
    label: { en: 'Student', bn: 'শিক্ষার্থী' },
  },
  {
    key: 'source_enrollment',
    type: 'ref',
    ref: 'enrollments',
    required: true,
    label: { en: 'Source enrollment', bn: 'উৎস ভর্তি' },
  },
  {
    key: 'source_section',
    type: 'ref',
    ref: 'sections',
    label: { en: 'Source section', bn: 'উৎস শাখা' },
  },
  { key: 'merit_rank', type: 'int', label: { en: 'Merit rank', bn: 'মেধাক্রম' } },
  { key: 'mean_gpa', type: 'money', label: { en: 'Mean GPA', bn: 'গড় জিপিএ' } },
  {
    key: 'total_marks_sum',
    type: 'money',
    label: { en: 'Total marks sum', bn: 'মোট নম্বরের যোগফল' },
  },
  {
    key: 'passed_all',
    type: 'bool',
    required: true,
    label: { en: 'Passed all', bn: 'সব পাস' },
  },
  {
    key: 'suggested_outcome',
    type: 'enum',
    enumValues: Object.values(PromotionOutcome),
    required: true,
    label: { en: 'Suggested outcome', bn: 'প্রস্তাবিত ফলাফল' },
  },
  {
    key: 'final_outcome',
    type: 'enum',
    enumValues: Object.values(PromotionOutcome),
    required: true,
    label: { en: 'Final outcome', bn: 'চূড়ান্ত ফলাফল' },
  },
  {
    key: 'is_override',
    type: 'bool',
    required: true,
    label: { en: 'Is override', bn: 'ওভাররাইড কিনা' },
  },
  {
    key: 'override_note',
    type: 'string',
    label: { en: 'Override note', bn: 'ওভাররাইড নোট' },
  },
  {
    key: 'overridden_by',
    type: 'uuid',
    label: { en: 'Overridden by (user id)', bn: 'ওভাররাইডকারী (ইউজার আইডি)' },
  },
  { key: 'group_name', type: 'string', label: { en: 'Group', bn: 'গ্রুপ' } },
  {
    key: 'target_class',
    type: 'ref',
    ref: 'classes',
    label: { en: 'Target class', bn: 'লক্ষ্য শ্রেণী' },
  },
  {
    key: 'target_section',
    type: 'ref',
    ref: 'sections',
    label: { en: 'Target section', bn: 'লক্ষ্য শাখা' },
  },
  { key: 'new_roll_number', type: 'int', label: { en: 'New roll number', bn: 'নতুন রোল নম্বর' } },
  {
    key: 'placement_error',
    type: 'string',
    label: { en: 'Placement error', bn: 'স্থাপন ত্রুটি' },
  },
  {
    key: 'target_enrollment',
    type: 'ref',
    ref: 'enrollments',
    label: { en: 'Target enrollment', bn: 'লক্ষ্য ভর্তি' },
  },
];

/**
 * `PromotionEntry` columns deliberately left out of the workbook. The
 * completeness gate (`registry.completeness.spec.ts`) fails if a new
 * `PromotionEntry` column appears in neither `columns` nor here.
 */
const excluded: readonly string[] = [
  'run_id', // exported instead as the `run` ref column
  'student_id', // exported instead as the `student` ref column
  'source_enrollment_id', // exported instead as the `source_enrollment` ref column
  'source_section_id', // exported instead as the `source_section` ref column
  'target_class_id', // exported instead as the `target_class` ref column
  'target_section_id', // exported instead as the `target_section` ref column
  'target_enrollment_id', // exported instead as the `target_enrollment` ref column
  'overridden_by_user_id', // exported instead as the `overridden_by` uuid column — same reasoning as `promotion-runs.tab.ts`'s `committed_by`/`approved_by`/`created_by`
];

const MAX_LENGTHS: Record<string, number> = {
  group_name: 100,
  placement_error: 500,
};

export const promotionEntriesTab: TabSpec<PromotionEntry, PromotionEntryRow> = {
  name: 'promotion_entries',
  entity: PromotionEntry,
  excluded,
  // `students`/`sections`/`classes`/`enrollments` are needed even though
  // some are optional columns, because those columns still resolve against
  // those tabs (`assertRegistryValid`, `registry.ts`).
  dependsOn: ['promotion_runs', 'students', 'enrollments', 'sections', 'classes'],
  columns,
  naturalKey: ['run', 'student'],
  deleteByAbsence: true,

  async load(tenantId: string, m: EntityManager): Promise<PromotionEntry[]> {
    // `PromotionEntry` has no `@ManyToOne` for `student_id` (a plain uuid
    // column), so the student's own natural key is resolved with a second,
    // independent query below — same reasoning as `sections.tab.ts`'s
    // "second, independent ref lookup" comment. `run`'s own key is now just
    // `run.id` (`promotion-runs.tab.ts`), so no relation or extra query is
    // needed to build it.
    const entries = await m.find(PromotionEntry, {
      where: { tenant_id: tenantId },
    });
    if (entries.length === 0) return entries;

    const studentIds = [...new Set(entries.map((e) => e.student_id))];
    const students = await m.find(Student, { where: { id: In(studentIds) } });
    const studentRegNoById = new Map(students.map((s) => [s.id, s.registration_number]));
    for (const entry of entries) {
      (
        entry as PromotionEntry & { _student_registration_number?: string }
      )._student_registration_number = studentRegNoById.get(entry.student_id) ?? '';
    }

    return entries;
  },

  toRow(entity: PromotionEntry, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      run: ctx.keyOf('promotion_runs', entity.run_id),
      student: ctx.keyOf('students', entity.student_id),
      source_enrollment: ctx.keyOf('enrollments', entity.source_enrollment_id),
      source_section: entity.source_section_id
        ? ctx.keyOf('sections', entity.source_section_id)
        : null,
      merit_rank: entity.merit_rank,
      mean_gpa: entity.mean_gpa,
      total_marks_sum: entity.total_marks_sum,
      passed_all: entity.passed_all,
      suggested_outcome: entity.suggested_outcome,
      final_outcome: entity.final_outcome,
      is_override: entity.is_override,
      override_note: entity.override_note,
      overridden_by: entity.overridden_by_user_id,
      group_name: entity.group_name,
      target_class: entity.target_class_id ? ctx.keyOf('classes', entity.target_class_id) : null,
      target_section: entity.target_section_id
        ? ctx.keyOf('sections', entity.target_section_id)
        : null,
      new_roll_number: entity.new_roll_number,
      placement_error: entity.placement_error,
      target_enrollment: entity.target_enrollment_id
        ? ctx.keyOf('enrollments', entity.target_enrollment_id)
        : null,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: PromotionEntryRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'promotion_entries', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }

      const limit = MAX_LENGTHS[column.key];
      if (limit !== undefined && typeof result.value === 'string' && result.value.length > limit) {
        errors.push({
          tab: 'promotion_entries',
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

    function resolveRequiredRef(column: string, ref: string, key: string): string | undefined {
      const id = ctx.ref(ref, key);
      if (!id) {
        errors.push({
          tab: 'promotion_entries',
          row: rowNo,
          column,
          message: `Column "${column}": no ${ref.replace('_', ' ')} "${key}" was found.`,
          severity: 'error',
          value: key,
        });
      }
      return id;
    }

    function resolveOptionalRef(column: string, ref: string, key: string | null): string | null {
      if (!key) return null;
      const id = ctx.ref(ref, key);
      if (!id) {
        errors.push({
          tab: 'promotion_entries',
          row: rowNo,
          column,
          message: `Column "${column}": no ${ref.replace('_', ' ')} "${key}" was found.`,
          severity: 'error',
          value: key,
        });
        return null;
      }
      return id;
    }

    const runKey = values.run as string;
    const runId = resolveRequiredRef('run', 'promotion_runs', runKey);
    const studentKey = values.student as string;
    const studentId = resolveRequiredRef('student', 'students', studentKey);
    const sourceEnrollmentKey = values.source_enrollment as string;
    const sourceEnrollmentId = resolveRequiredRef(
      'source_enrollment',
      'enrollments',
      sourceEnrollmentKey,
    );
    const sourceSectionId = resolveOptionalRef(
      'source_section',
      'sections',
      (values.source_section as string | null) ?? null,
    );
    const targetClassId = resolveOptionalRef(
      'target_class',
      'classes',
      (values.target_class as string | null) ?? null,
    );
    const targetSectionId = resolveOptionalRef(
      'target_section',
      'sections',
      (values.target_section as string | null) ?? null,
    );
    const targetEnrollmentId = resolveOptionalRef(
      'target_enrollment',
      'enrollments',
      (values.target_enrollment as string | null) ?? null,
    );

    if (errors.length > 0) return { errors };

    // Mirrors the entity's own DB CHECK (`CHK_promotion_entries_override_note`):
    // `is_override` requires a non-blank `override_note`. Checked here so a
    // bad row produces one `RowError` instead of a Postgres 23514 that
    // aborts the whole restore.
    const isOverride = values.is_override as boolean;
    const overrideNote = (values.override_note as string | null) ?? null;
    if (isOverride && (!overrideNote || overrideNote.trim().length === 0)) {
      errors.push({
        tab: 'promotion_entries',
        row: rowNo,
        column: 'override_note',
        message: 'Column "override_note": is required when "is_override" is true.',
        severity: 'error',
        value: overrideNote ?? '',
      });
    }

    if (errors.length > 0) return { errors };

    return {
      row: {
        id: values.id as string,
        run_id: runId as string,
        student_id: studentId as string,
        source_enrollment_id: sourceEnrollmentId as string,
        source_section_id: sourceSectionId,
        merit_rank: (values.merit_rank as number | null) ?? null,
        mean_gpa: (values.mean_gpa as string | null) ?? null,
        total_marks_sum: (values.total_marks_sum as string | null) ?? null,
        passed_all: values.passed_all as boolean,
        suggested_outcome: values.suggested_outcome as PromotionOutcome,
        final_outcome: values.final_outcome as PromotionOutcome,
        is_override: isOverride,
        override_note: overrideNote,
        overridden_by_user_id: (values.overridden_by as string | null) ?? null,
        group_name: (values.group_name as string | null) ?? null,
        target_class_id: targetClassId,
        target_section_id: targetSectionId,
        new_roll_number: (values.new_roll_number as number | null) ?? null,
        placement_error: (values.placement_error as string | null) ?? null,
        target_enrollment_id: targetEnrollmentId,
        student_key: studentKey,
      },
    };
  },

  keyOf(x: PromotionEntryRow | PromotionEntry): string {
    // `run_id` (not `run_key`/the workbook ref text) — `promotionRunsTab`'s
    // own key is now `id` (see its docstring), so the run's identity here is
    // just its id in both the entity and the parsed-row case.
    const runKey = x.run_id;
    const studentKey =
      x instanceof PromotionEntry
        ? ((
            x as PromotionEntry & { _student_registration_number?: string }
          )._student_registration_number?.trim() ?? '')
        : x.student_key;
    return `${runKey}|${studentKey}`;
  },

  diffFields(row: PromotionEntryRow, existing: PromotionEntry): string[] {
    const changed: string[] = [];
    if (row.run_id !== existing.run_id) changed.push('run');
    if (row.student_id !== existing.student_id) changed.push('student');
    if (row.source_enrollment_id !== existing.source_enrollment_id)
      changed.push('source_enrollment');
    if ((row.source_section_id ?? null) !== (existing.source_section_id ?? null)) {
      changed.push('source_section');
    }
    if ((row.merit_rank ?? null) !== (existing.merit_rank ?? null)) changed.push('merit_rank');
    if (String(row.mean_gpa ?? '') !== String(existing.mean_gpa ?? '')) changed.push('mean_gpa');
    if (String(row.total_marks_sum ?? '') !== String(existing.total_marks_sum ?? '')) {
      changed.push('total_marks_sum');
    }
    if (row.passed_all !== existing.passed_all) changed.push('passed_all');
    if (row.suggested_outcome !== existing.suggested_outcome) changed.push('suggested_outcome');
    if (row.final_outcome !== existing.final_outcome) changed.push('final_outcome');
    if (row.is_override !== existing.is_override) changed.push('is_override');
    if ((row.override_note ?? null) !== (existing.override_note ?? null))
      changed.push('override_note');
    if ((row.overridden_by_user_id ?? null) !== (existing.overridden_by_user_id ?? null)) {
      changed.push('overridden_by');
    }
    if ((row.group_name ?? null) !== (existing.group_name ?? null)) changed.push('group_name');
    if ((row.target_class_id ?? null) !== (existing.target_class_id ?? null))
      changed.push('target_class');
    if ((row.target_section_id ?? null) !== (existing.target_section_id ?? null)) {
      changed.push('target_section');
    }
    if ((row.new_roll_number ?? null) !== (existing.new_roll_number ?? null)) {
      changed.push('new_roll_number');
    }
    if ((row.placement_error ?? null) !== (existing.placement_error ?? null)) {
      changed.push('placement_error');
    }
    if ((row.target_enrollment_id ?? null) !== (existing.target_enrollment_id ?? null)) {
      changed.push('target_enrollment');
    }
    return changed;
  },

  async upsert(
    row: PromotionEntryRow,
    existing: PromotionEntry | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<PromotionEntry> {
    const entry = existing ?? new PromotionEntry();

    entry.tenant_id = tenantId;
    entry.run_id = row.run_id;
    entry.student_id = row.student_id;
    entry.source_enrollment_id = row.source_enrollment_id;
    entry.source_section_id = row.source_section_id;
    entry.merit_rank = row.merit_rank;
    entry.mean_gpa = row.mean_gpa;
    entry.total_marks_sum = row.total_marks_sum;
    entry.passed_all = row.passed_all;
    entry.suggested_outcome = row.suggested_outcome;
    entry.final_outcome = row.final_outcome;
    entry.is_override = row.is_override;
    entry.override_note = row.override_note;
    entry.overridden_by_user_id = row.overridden_by_user_id;
    entry.group_name = row.group_name;
    entry.target_class_id = row.target_class_id;
    entry.target_section_id = row.target_section_id;
    entry.new_roll_number = row.new_roll_number;
    entry.placement_error = row.placement_error;
    entry.target_enrollment_id = row.target_enrollment_id;

    return m.save(PromotionEntry, entry);
  },

  async remove(entity: PromotionEntry, m: EntityManager): Promise<void> {
    // Hard delete: the entity has no `deleted_at` — entries are removed via
    // `run_id` CASCADE when their (hard-deleted) run is discarded (D24).
    await m.remove(PromotionEntry, entity);
  },
};
