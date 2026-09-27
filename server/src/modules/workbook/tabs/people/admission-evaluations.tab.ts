import type { EntityManager } from 'typeorm';
import { AdmissionEvaluation } from '../../../admission/entities/admission-evaluation.entity';
import type { AdmissionEvaluationDecision } from '@biddaloy/shared';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';
import { admissionApplicantsTab } from './admission-applicants.tab';

/**
 * The `admission_evaluations` tab (Epic 27.0): a reviewer's decision on one
 * `admission_applicants` row.
 *
 * Append-only on the entity side — a re-review adds a new row rather than
 * editing the old one (`admission-evaluation.entity.ts`) — so there is no
 * single-column natural key the way `reference_number` is for applicants.
 * `keyOf` uses (applicant, reviewer, decision, notes): reliable for the real
 * flow (shortlist then admit produces two rows with different decisions),
 * but two evaluations from the same reviewer with the same decision and
 * identical notes text would collide and overwrite on restore — the same
 * weak-key tradeoff `payments.tab.ts` documents for a cash payment with no
 * `transaction_reference`.
 *
 * `reviewer_user_id` is a plain uuid column with no `@ManyToOne` relation
 * (`admission-evaluation.entity.ts`), so the entity branch of `keyOf` has no
 * loaded `User` to read a natural key off of and falls back to the raw ids
 * for both `applicant`/`reviewer`. This only affects cross-tenant restore
 * matching and the diff preview's sample text — same-tenant restore (the
 * common case) matches by `id` first (`restore.processor.ts`), before
 * `keyOf` is ever consulted.
 */
export interface AdmissionEvaluationRow {
  id: string;
  applicant_id: string;
  applicant_key: string;
  reviewer_user_id: string;
  reviewer_key: string;
  notes: string;
  decision: AdmissionEvaluationDecision | null;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  {
    key: 'applicant',
    type: 'ref',
    ref: 'admission_applicants',
    required: true,
    label: { en: 'Applicant', bn: 'আবেদনকারী' },
  },
  {
    key: 'reviewer',
    type: 'ref',
    ref: 'users',
    required: true,
    label: { en: 'Reviewer', bn: 'পর্যালোচক' },
  },
  { key: 'notes', type: 'string', required: true, label: { en: 'Notes', bn: 'মন্তব্য' } },
  {
    key: 'decision',
    type: 'enum',
    enumValues: ['SHORTLIST', 'ADMIT', 'REJECT'],
    label: { en: 'Decision', bn: 'সিদ্ধান্ত' },
  },
];

const excluded: readonly string[] = [
  'applicant_id', // exported instead as the `applicant` ref column
  'reviewer_user_id', // exported instead as the `reviewer` ref column
];

export const admissionEvaluationsTab: TabSpec<AdmissionEvaluation, AdmissionEvaluationRow> = {
  name: 'admission_evaluations',
  entity: AdmissionEvaluation,
  excluded,
  dependsOn: ['admission_applicants', 'users'],
  columns,
  naturalKey: ['applicant', 'reviewer', 'decision', 'notes'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<AdmissionEvaluation[]> {
    return m.find(AdmissionEvaluation, {
      where: { tenant_id: tenantId },
      relations: ['applicant'],
    });
  },

  toRow(entity: AdmissionEvaluation, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      applicant: ctx.keyOf('admission_applicants', entity.applicant_id),
      reviewer: ctx.keyOf('users', entity.reviewer_user_id),
      notes: entity.notes,
      decision: entity.decision,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: AdmissionEvaluationRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'admission_evaluations', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }
      values[column.key] = result.value;
    }

    if (errors.length > 0) return { errors };

    const applicantKey = values.applicant as string;
    const applicantId = ctx.ref('admission_applicants', applicantKey);
    if (!applicantId) {
      errors.push({
        tab: 'admission_evaluations',
        row: rowNo,
        column: 'applicant',
        message: `Column "applicant": no applicant with the key "${applicantKey}" was found.`,
        severity: 'error',
        value: applicantKey,
      });
    }

    const reviewerKey = values.reviewer as string;
    const reviewerId = ctx.ref('users', reviewerKey);
    if (!reviewerId) {
      errors.push({
        tab: 'admission_evaluations',
        row: rowNo,
        column: 'reviewer',
        message: `Column "reviewer": no user with the key "${reviewerKey}" was found.`,
        severity: 'error',
        value: reviewerKey,
      });
    }

    if (errors.length > 0) return { errors };

    return {
      row: {
        id: values.id as string,
        applicant_id: applicantId as string,
        applicant_key: applicantKey,
        reviewer_user_id: reviewerId as string,
        reviewer_key: reviewerKey,
        notes: values.notes as string,
        decision: (values.decision as AdmissionEvaluationDecision | null) ?? null,
      },
    };
  },

  keyOf(x: AdmissionEvaluationRow | AdmissionEvaluation): string {
    // `applicant` is loaded (`load()` eager-loads it) so it reuses
    // `admissionApplicantsTab.keyOf` like other tabs do for a loaded
    // relation. `reviewer` has no relation to load (see the file doc
    // comment on `reviewer_user_id`), so the entity branch falls back to
    // the raw id.
    const applicantKey =
      x instanceof AdmissionEvaluation
        ? x.applicant
          ? admissionApplicantsTab.keyOf(x.applicant)
          : x.applicant_id
        : x.applicant_key;
    const reviewerKey = x instanceof AdmissionEvaluation ? x.reviewer_user_id : x.reviewer_key;
    return `${applicantKey}|${reviewerKey}|${x.decision ?? ''}|${x.notes}`;
  },

  diffFields(row: AdmissionEvaluationRow, existing: AdmissionEvaluation): string[] {
    // Every natural-key field is compared for parity with other tabs, but in
    // practice a matched row never differs — the key already covers
    // applicant, reviewer, decision, and notes.
    const changed: string[] = [];
    if (row.applicant_id !== existing.applicant_id) changed.push('applicant');
    if (row.reviewer_user_id !== existing.reviewer_user_id) changed.push('reviewer');
    if (row.notes !== existing.notes) changed.push('notes');
    if (row.decision !== existing.decision) changed.push('decision');
    return changed;
  },

  async upsert(
    row: AdmissionEvaluationRow,
    existing: AdmissionEvaluation | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<AdmissionEvaluation> {
    const evaluation = existing ?? new AdmissionEvaluation();
    evaluation.tenant_id = tenantId;
    evaluation.applicant_id = row.applicant_id;
    evaluation.reviewer_user_id = row.reviewer_user_id;
    evaluation.notes = row.notes;
    evaluation.decision = row.decision;

    return m.save(AdmissionEvaluation, evaluation);
  },

  async remove(entity: AdmissionEvaluation, m: EntityManager): Promise<void> {
    // No `deleted_at` on this entity (append-only audit trail) — hard delete.
    await m.remove(AdmissionEvaluation, entity);
  },
};
