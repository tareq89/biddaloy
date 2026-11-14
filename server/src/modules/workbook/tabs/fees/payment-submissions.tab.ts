import type { EntityManager } from 'typeorm';
import {
  PaymentGatewayEnvironment,
  PaymentGatewayProvider,
  PaymentMethod,
  PaymentProofRejectReason,
  PaymentSubmissionSource,
  PaymentSubmissionStatus,
} from '@biddaloy/shared';
import { PaymentSubmission } from '../../../payment-submissions/entities/payment-submission.entity';
import { PaymentSubmissionBill } from '../../../payment-submissions/entities/payment-submission-bill.entity';
import { PaymentSubmissionFile } from '../../../payment-submissions/entities/payment-submission-file.entity';
import { PaymentSubmissionEvent } from '../../../payment-submissions/entities/payment-submission-event.entity';
import { formatDateOnly, formatDateTime, fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';
import { optionalKeyOf } from '../../codec/tab-spec';
import { actorOrRestorer, nullableActor, stampActorKeys } from '../actor-keys';

/**
 * The four guardian payment-submission tabs (Epic 3.0 #291, D35): `payment_submissions`,
 * `payment_submission_bills`, `payment_submission_files` and `payment_submission_events`.
 *
 * Every tab is keyed by the row's own `id` (like `promotion_runs`): children reference their
 * submission by that id, and a restore reuses it so the references round-trip.
 *
 * Restore writes rows only. It never calls the submit / approve / settle services, which
 * would replay side effects (payments, SMS, status events).
 *
 * D32: the files tab carries `storage_key`, `content_type`, `size_bytes` and the name hash
 * only. The image bytes stay in object storage and are never read here. No gateway secret
 * is stored on any of these entities, so nothing secret reaches the workbook.
 */

type Cells = Record<string, string>;
type Values = Record<string, unknown>;

const label = (en: string, bn: string) => ({ en, bn });
const ID_COLUMN: ColumnSpec = {
  key: 'id',
  type: 'uuid',
  required: true,
  label: label('ID', 'আইডি'),
};
const CREATED_AT: ColumnSpec = {
  // Kept so a restore reproduces the timestamps exactly; empty = now.
  key: 'created_at',
  type: 'datetime',
  label: label('Created at', 'তৈরির সময়'),
};

function unresolved(tab: string, rowNo: number, column: string, key: string): RowError {
  return {
    tab,
    row: rowNo,
    column,
    message: `Column "${column}": no row with the key "${key}" was found.`,
    severity: 'error',
    value: key,
  };
}

/** Parses every column, then resolves each `ref` column to an id (blank stays null). */
function parse(
  tab: string,
  columns: readonly ColumnSpec[],
  cells: Cells,
  rowNo: number,
  ctx: ImportContext,
): { values: Values; ids: Values } | { errors: RowError[] } {
  const errors: RowError[] = [];
  const values: Values = {};
  for (const column of columns) {
    const result = fromCell(column, cells[column.key] ?? '', tab, rowNo);
    if ('error' in result) errors.push(result.error);
    else values[column.key] = result.value;
  }
  if (errors.length > 0) return { errors };
  const ids: Values = {};
  for (const column of columns) {
    if (column.type !== 'ref') continue;
    const key = (values[column.key] as string | null) ?? '';
    if (!key) {
      ids[column.key] = null;
      continue;
    }
    const id = ctx.ref(column.ref as string, key);
    if (!id) errors.push(unresolved(tab, rowNo, column.key, key));
    ids[column.key] = id ?? null;
  }
  return errors.length > 0 ? { errors } : { values, ids };
}

/** A fresh row reuses the workbook's id, so refuse one another school already holds. */
async function newWithId<E extends { id: string; tenant_id: string }>(
  entity: new () => E,
  id: string,
  tenantId: string,
  m: EntityManager,
): Promise<E> {
  const holder = await m.findOne(entity as never, { where: { id } as never });
  if (holder && (holder as E).tenant_id !== tenantId) {
    throw new Error(`Row "${id}" already exists in another school and cannot be restored here.`);
  }
  const fresh = new entity();
  fresh.id = id;
  fresh.tenant_id = tenantId;
  return fresh;
}

const dt = (v: Date | string | null | undefined) => (v ? formatDateTime(v) : null);
const changedFields = (pairs: Array<[string, unknown, unknown]>): string[] =>
  pairs.filter(([, a, b]) => (a ?? null) !== (b ?? null)).map(([name]) => name);
const toDate = (v: unknown) => (v ? new Date(v as string) : null);

// ---------------------------------------------------------------------------
// payment_submissions
// ---------------------------------------------------------------------------

export interface PaymentSubmissionRow {
  id: string;
  source: PaymentSubmissionSource;
  status: PaymentSubmissionStatus;
  submitted_by_user_id: string | null;
  submitted_by_key: string;
  method: PaymentMethod | null;
  amount: string;
  paid_on: string | null;
  reference_raw: string | null;
  reference_normalised: string | null;
  provider: PaymentGatewayProvider | null;
  environment: PaymentGatewayEnvironment | null;
  provider_payment_id: string | null;
  provider_trx_id: string | null;
  reject_reason: PaymentProofRejectReason | null;
  reject_note: string | null;
  decided_by_user_id: string | null;
  decided_by_key: string;
  decided_at: string | null;
  discard_reason: string | null;
  unmatched: boolean;
  started_at: string | null;
  settled_at: string | null;
  expires_at: string | null;
  created_at: string | null;
}

const submissionColumns: readonly ColumnSpec[] = [
  ID_COLUMN,
  {
    key: 'source',
    type: 'enum',
    required: true,
    enumValues: Object.values(PaymentSubmissionSource),
    label: label('Source', 'উৎস'),
  },
  {
    key: 'status',
    type: 'enum',
    required: true,
    enumValues: Object.values(PaymentSubmissionStatus),
    label: label('Status', 'অবস্থা'),
  },
  {
    key: 'submitted_by',
    type: 'ref',
    ref: 'users',
    restorerOnNewRow: true,
    label: label('Submitted by', 'জমাদাতা'),
  },
  {
    key: 'method',
    type: 'enum',
    enumValues: Object.values(PaymentMethod),
    label: label('Method', 'পদ্ধতি'),
  },
  { key: 'amount', type: 'money', required: true, label: label('Amount', 'পরিমাণ') },
  { key: 'paid_on', type: 'date', label: label('Paid on', 'পরিশোধের তারিখ') },
  { key: 'reference_raw', type: 'string', label: label('Reference', 'রেফারেন্স') },
  {
    key: 'reference_normalised',
    type: 'string',
    label: label('Reference (normalised)', 'রেফারেন্স (স্বাভাবিক)'),
  },
  {
    key: 'provider',
    type: 'enum',
    enumValues: Object.values(PaymentGatewayProvider),
    label: label('Provider', 'প্রদানকারী'),
  },
  {
    key: 'environment',
    type: 'enum',
    enumValues: Object.values(PaymentGatewayEnvironment),
    label: label('Environment', 'পরিবেশ'),
  },
  {
    key: 'provider_payment_id',
    type: 'string',
    label: label('Provider payment ID', 'প্রদানকারীর পেমেন্ট আইডি'),
  },
  {
    key: 'provider_trx_id',
    type: 'string',
    label: label('Provider transaction ID', 'প্রদানকারীর ট্রানজেকশন আইডি'),
  },
  {
    key: 'reject_reason',
    type: 'enum',
    enumValues: Object.values(PaymentProofRejectReason),
    label: label('Reject reason', 'প্রত্যাখ্যানের কারণ'),
  },
  { key: 'reject_note', type: 'string', label: label('Reject note', 'প্রত্যাখ্যানের মন্তব্য') },
  { key: 'decided_by', type: 'ref', ref: 'users', label: label('Decided by', 'সিদ্ধান্তদাতা') },
  { key: 'decided_at', type: 'datetime', label: label('Decided at', 'সিদ্ধান্তের সময়') },
  { key: 'discard_reason', type: 'string', label: label('Discard reason', 'বাতিলের কারণ') },
  { key: 'unmatched', type: 'bool', required: true, label: label('Unmatched', 'অমিলিত') },
  { key: 'started_at', type: 'datetime', label: label('Started at', 'শুরুর সময়') },
  { key: 'settled_at', type: 'datetime', label: label('Settled at', 'নিষ্পত্তির সময়') },
  { key: 'expires_at', type: 'datetime', label: label('Expires at', 'মেয়াদ শেষের সময়') },
  CREATED_AT,
];

export const paymentSubmissionsTab: TabSpec<PaymentSubmission, PaymentSubmissionRow> = {
  name: 'payment_submissions',
  entity: PaymentSubmission,
  excluded: [
    'submitted_by_user_id', // exported instead as the `submitted_by` ref column
    'decided_by_user_id', // exported instead as the `decided_by` ref column
  ],
  dependsOn: ['users'],
  columns: submissionColumns,
  naturalKey: ['id'],
  deleteByAbsence: true,

  async load(tenantId, m) {
    const rows = await m.find(PaymentSubmission, { where: { tenant_id: tenantId } });
    await stampActorKeys(tenantId, rows, 'submitted_by_user_id', 'submitted_by_key', m);
    return stampActorKeys(tenantId, rows, 'decided_by_user_id', 'decided_by_key', m);
  },

  toRow(e, ctx: ExportContext) {
    return {
      id: e.id,
      source: e.source,
      status: e.status,
      submitted_by: optionalKeyOf(ctx, 'users', e.submitted_by_user_id),
      method: e.method,
      amount: e.amount,
      paid_on: e.paid_on,
      reference_raw: e.reference_raw,
      reference_normalised: e.reference_normalised,
      provider: e.provider,
      environment: e.environment,
      provider_payment_id: e.provider_payment_id,
      provider_trx_id: e.provider_trx_id,
      reject_reason: e.reject_reason,
      reject_note: e.reject_note,
      decided_by: e.decided_by_user_id ? optionalKeyOf(ctx, 'users', e.decided_by_user_id) : null,
      decided_at: e.decided_at,
      discard_reason: e.discard_reason,
      unmatched: e.unmatched,
      started_at: e.started_at,
      settled_at: e.settled_at,
      expires_at: e.expires_at,
      created_at: e.created_at,
    };
  },

  fromRow(cells, rowNo, ctx) {
    const parsed = parse('payment_submissions', submissionColumns, cells, rowNo, ctx);
    if ('errors' in parsed) return parsed;
    const { values: v, ids } = parsed;
    const str = (k: string) => (v[k] as string | null) ?? null;
    return {
      row: {
        id: v.id as string,
        source: v.source as PaymentSubmissionSource,
        status: v.status as PaymentSubmissionStatus,
        submitted_by_user_id: ids.submitted_by as string | null,
        submitted_by_key: str('submitted_by') ?? '',
        method: str('method') as PaymentMethod | null,
        amount: v.amount as string,
        paid_on: str('paid_on'),
        reference_raw: str('reference_raw'),
        reference_normalised: str('reference_normalised'),
        provider: str('provider') as PaymentGatewayProvider | null,
        environment: str('environment') as PaymentGatewayEnvironment | null,
        provider_payment_id: str('provider_payment_id'),
        provider_trx_id: str('provider_trx_id'),
        reject_reason: str('reject_reason') as PaymentProofRejectReason | null,
        reject_note: str('reject_note'),
        decided_by_user_id: ids.decided_by as string | null,
        decided_by_key: str('decided_by') ?? '',
        decided_at: str('decided_at'),
        discard_reason: str('discard_reason'),
        unmatched: v.unmatched as boolean,
        started_at: str('started_at'),
        settled_at: str('settled_at'),
        expires_at: str('expires_at'),
        created_at: str('created_at'),
      },
    };
  },

  keyOf: (x) => x.id,

  diffFields(row, e) {
    const changed = changedFields([
      ['source', row.source, e.source],
      ['status', row.status, e.status],
      ['method', row.method, e.method],
      ['amount', String(row.amount), String(e.amount)],
      [
        'paid_on',
        row.paid_on ? formatDateOnly(row.paid_on) : null,
        e.paid_on ? formatDateOnly(e.paid_on) : null,
      ],
      ['reference_raw', row.reference_raw, e.reference_raw],
      ['reference_normalised', row.reference_normalised, e.reference_normalised],
      ['provider', row.provider, e.provider],
      ['environment', row.environment, e.environment],
      ['provider_payment_id', row.provider_payment_id, e.provider_payment_id],
      ['provider_trx_id', row.provider_trx_id, e.provider_trx_id],
      ['reject_reason', row.reject_reason, e.reject_reason],
      ['reject_note', row.reject_note, e.reject_note],
      ['decided_at', dt(row.decided_at), dt(e.decided_at)],
      ['discard_reason', row.discard_reason, e.discard_reason],
      ['unmatched', row.unmatched, e.unmatched],
      ['started_at', dt(row.started_at), dt(e.started_at)],
      ['settled_at', dt(row.settled_at), dt(e.settled_at)],
      ['expires_at', dt(row.expires_at), dt(e.expires_at)],
    ]);
    // A blank actor cell clears a current user; a departed one is kept (#2687).
    if (
      nullableActor(row.decided_by_user_id, e, 'decided_by_user_id', 'decided_by_key') !==
      (e.decided_by_user_id ?? null)
    )
      changed.push('decided_by');
    if (row.submitted_by_user_id && row.submitted_by_user_id !== e.submitted_by_user_id)
      changed.push('submitted_by');
    return changed;
  },

  async upsert(row, existing, tenantId, m, actorUserId) {
    const s = existing ?? (await newWithId(PaymentSubmission, row.id, tenantId, m));
    s.source = row.source;
    s.status = row.status;
    s.submitted_by_user_id = actorOrRestorer(
      `Payment submission "${row.id}": "submitted_by"`,
      row.submitted_by_user_id,
      existing?.submitted_by_user_id,
      actorUserId,
    );
    s.method = row.method;
    s.amount = row.amount as unknown as number;
    s.paid_on = row.paid_on;
    s.reference_raw = row.reference_raw;
    s.reference_normalised = row.reference_normalised;
    s.provider = row.provider;
    s.environment = row.environment;
    s.provider_payment_id = row.provider_payment_id;
    s.provider_trx_id = row.provider_trx_id;
    s.reject_reason = row.reject_reason;
    s.reject_note = row.reject_note;
    s.decided_by_user_id = nullableActor(
      row.decided_by_user_id,
      existing,
      'decided_by_user_id',
      'decided_by_key',
    );
    s.decided_at = toDate(row.decided_at);
    s.discard_reason = row.discard_reason;
    s.unmatched = row.unmatched;
    s.started_at = toDate(row.started_at);
    s.settled_at = toDate(row.settled_at);
    s.expires_at = toDate(row.expires_at);
    if (row.created_at) s.created_at = new Date(row.created_at);
    return m.save(PaymentSubmission, s);
  },

  async remove(entity, m) {
    // Bills, files and events go with it (ON DELETE CASCADE). Bills hold RESTRICT FKs to
    // payments / student_fees, so a restore removes them first through their own tab.
    await m.delete(PaymentSubmission, { id: entity.id });
  },
};

// ---------------------------------------------------------------------------
// payment_submission_bills
// ---------------------------------------------------------------------------

export interface PaymentSubmissionBillRow {
  id: string;
  submission_id: string;
  student_fee_id: string;
  student_id: string;
  amount_at_start: string;
  payment_id: string | null;
  created_at: string | null;
}

const billColumns: readonly ColumnSpec[] = [
  ID_COLUMN,
  {
    key: 'submission',
    type: 'ref',
    ref: 'payment_submissions',
    required: true,
    label: label('Submission', 'জমা'),
  },
  {
    key: 'student_fee',
    type: 'ref',
    ref: 'student_fees',
    required: true,
    label: label('Student fee', 'শিক্ষার্থীর ফি'),
  },
  {
    key: 'student',
    type: 'ref',
    ref: 'students',
    required: true,
    label: label('Student', 'শিক্ষার্থী'),
  },
  {
    key: 'amount_at_start',
    type: 'money',
    required: true,
    label: label('Amount at start', 'শুরুর পরিমাণ'),
  },
  { key: 'payment', type: 'ref', ref: 'payments', label: label('Payment', 'পরিশোধ') },
  CREATED_AT,
];

export const paymentSubmissionBillsTab: TabSpec<PaymentSubmissionBill, PaymentSubmissionBillRow> = {
  name: 'payment_submission_bills',
  entity: PaymentSubmissionBill,
  excluded: [
    'submission_id', // exported instead as the `submission` ref column
    'student_fee_id', // exported instead as the `student_fee` ref column
    'student_id', // exported instead as the `student` ref column
    'payment_id', // exported instead as the `payment` ref column
  ],
  dependsOn: ['payment_submissions', 'student_fees', 'students', 'payments'],
  columns: billColumns,
  naturalKey: ['id'],
  deleteByAbsence: true,

  load: (tenantId, m) => m.find(PaymentSubmissionBill, { where: { tenant_id: tenantId } }),

  toRow(e, ctx: ExportContext) {
    return {
      id: e.id,
      submission: ctx.keyOf('payment_submissions', e.submission_id),
      student_fee: ctx.keyOf('student_fees', e.student_fee_id),
      student: ctx.keyOf('students', e.student_id),
      amount_at_start: e.amount_at_start,
      payment: e.payment_id ? ctx.keyOf('payments', e.payment_id) : null,
      created_at: e.created_at,
    };
  },

  fromRow(cells, rowNo, ctx) {
    const parsed = parse('payment_submission_bills', billColumns, cells, rowNo, ctx);
    if ('errors' in parsed) return parsed;
    const { values: v, ids } = parsed;
    return {
      row: {
        id: v.id as string,
        submission_id: ids.submission as string,
        student_fee_id: ids.student_fee as string,
        student_id: ids.student as string,
        amount_at_start: v.amount_at_start as string,
        payment_id: ids.payment as string | null,
        created_at: (v.created_at as string | null) ?? null,
      },
    };
  },

  keyOf: (x) => x.id,

  diffFields: (row, e) =>
    changedFields([
      ['submission', row.submission_id, e.submission_id],
      ['student_fee', row.student_fee_id, e.student_fee_id],
      ['student', row.student_id, e.student_id],
      ['amount_at_start', String(row.amount_at_start), String(e.amount_at_start)],
      ['payment', row.payment_id, e.payment_id],
    ]),

  async upsert(row, existing, tenantId, m) {
    const b = existing ?? (await newWithId(PaymentSubmissionBill, row.id, tenantId, m));
    b.submission_id = row.submission_id;
    b.student_fee_id = row.student_fee_id;
    b.student_id = row.student_id;
    b.amount_at_start = row.amount_at_start as unknown as number;
    b.payment_id = row.payment_id;
    if (row.created_at) b.created_at = new Date(row.created_at);
    return m.save(PaymentSubmissionBill, b);
  },

  async remove(entity, m) {
    await m.delete(PaymentSubmissionBill, { id: entity.id });
  },
};

// ---------------------------------------------------------------------------
// payment_submission_files  (D32: storage keys only, never bytes)
// ---------------------------------------------------------------------------

export interface PaymentSubmissionFileRow {
  id: string;
  submission_id: string;
  storage_key: string;
  content_type: string;
  size_bytes: number;
  original_name_hash: string;
  created_at: string | null;
}

const fileColumns: readonly ColumnSpec[] = [
  ID_COLUMN,
  {
    key: 'submission',
    type: 'ref',
    ref: 'payment_submissions',
    required: true,
    label: label('Submission', 'জমা'),
  },
  {
    key: 'storage_key',
    type: 'string',
    required: true,
    label: label('Storage key', 'স্টোরেজ কী'),
  },
  {
    key: 'content_type',
    type: 'string',
    required: true,
    label: label('Content type', 'কনটেন্টের ধরন'),
  },
  { key: 'size_bytes', type: 'int', required: true, label: label('Size (bytes)', 'আকার (বাইট)') },
  {
    key: 'original_name_hash',
    type: 'string',
    required: true,
    label: label('Original name hash', 'মূল নামের হ্যাশ'),
  },
  CREATED_AT,
];

export const paymentSubmissionFilesTab: TabSpec<PaymentSubmissionFile, PaymentSubmissionFileRow> = {
  name: 'payment_submission_files',
  entity: PaymentSubmissionFile,
  excluded: ['submission_id'], // exported instead as the `submission` ref column
  dependsOn: ['payment_submissions'],
  columns: fileColumns,
  naturalKey: ['id'],
  // Proof images are evidence: a file row is never dropped because a backup lacks it
  // (it would orphan the stored object). It goes only with its submission (CASCADE).
  deleteByAbsence: false,

  load: (tenantId, m) => m.find(PaymentSubmissionFile, { where: { tenant_id: tenantId } }),

  toRow: (e, ctx: ExportContext) => ({
    id: e.id,
    submission: ctx.keyOf('payment_submissions', e.submission_id),
    storage_key: e.storage_key,
    content_type: e.content_type,
    size_bytes: e.size_bytes,
    original_name_hash: e.original_name_hash,
    created_at: e.created_at,
  }),

  fromRow(cells, rowNo, ctx) {
    const parsed = parse('payment_submission_files', fileColumns, cells, rowNo, ctx);
    if ('errors' in parsed) return parsed;
    const { values: v, ids } = parsed;
    return {
      row: {
        id: v.id as string,
        submission_id: ids.submission as string,
        storage_key: v.storage_key as string,
        content_type: v.content_type as string,
        size_bytes: v.size_bytes as number,
        original_name_hash: v.original_name_hash as string,
        created_at: (v.created_at as string | null) ?? null,
      },
    };
  },

  keyOf: (x) => x.id,

  diffFields: (row, e) =>
    changedFields([
      ['submission', row.submission_id, e.submission_id],
      ['storage_key', row.storage_key, e.storage_key],
      ['content_type', row.content_type, e.content_type],
      ['size_bytes', Number(row.size_bytes), Number(e.size_bytes)],
      ['original_name_hash', row.original_name_hash, e.original_name_hash],
    ]),

  async upsert(row, existing, tenantId, m) {
    const f = existing ?? (await newWithId(PaymentSubmissionFile, row.id, tenantId, m));
    f.submission_id = row.submission_id;
    f.storage_key = row.storage_key;
    f.content_type = row.content_type;
    f.size_bytes = row.size_bytes;
    f.original_name_hash = row.original_name_hash;
    if (row.created_at) f.created_at = new Date(row.created_at);
    return m.save(PaymentSubmissionFile, f);
  },

  async remove(entity, m) {
    await m.delete(PaymentSubmissionFile, { id: entity.id });
  },
};

// ---------------------------------------------------------------------------
// payment_submission_events  (append-only: insert only)
// ---------------------------------------------------------------------------

export interface PaymentSubmissionEventRow {
  id: string;
  submission_id: string;
  from_status: PaymentSubmissionStatus | null;
  to_status: PaymentSubmissionStatus;
  actor_user_id: string | null;
  reason_code: string | null;
  note: string | null;
  created_at: string | null;
}

const eventColumns: readonly ColumnSpec[] = [
  ID_COLUMN,
  {
    key: 'submission',
    type: 'ref',
    ref: 'payment_submissions',
    required: true,
    label: label('Submission', 'জমা'),
  },
  {
    key: 'from_status',
    type: 'enum',
    enumValues: Object.values(PaymentSubmissionStatus),
    label: label('From status', 'আগের অবস্থা'),
  },
  {
    key: 'to_status',
    type: 'enum',
    required: true,
    enumValues: Object.values(PaymentSubmissionStatus),
    label: label('To status', 'নতুন অবস্থা'),
  },
  { key: 'actor', type: 'ref', ref: 'users', label: label('Actor', 'সম্পাদনকারী') },
  { key: 'reason_code', type: 'string', label: label('Reason code', 'কারণের কোড') },
  { key: 'note', type: 'string', label: label('Note', 'মন্তব্য') },
  CREATED_AT,
];

export const paymentSubmissionEventsTab: TabSpec<
  PaymentSubmissionEvent,
  PaymentSubmissionEventRow
> = {
  name: 'payment_submission_events',
  entity: PaymentSubmissionEvent,
  excluded: [
    'submission_id', // exported instead as the `submission` ref column
    'actor_user_id', // exported instead as the `actor` ref column
  ],
  dependsOn: ['payment_submissions', 'users'],
  columns: eventColumns,
  naturalKey: ['id'],
  deleteByAbsence: false, // append-only history (D9): never deleted on restore

  load: (tenantId, m) => m.find(PaymentSubmissionEvent, { where: { tenant_id: tenantId } }),

  toRow: (e, ctx: ExportContext) => ({
    id: e.id,
    submission: ctx.keyOf('payment_submissions', e.submission_id),
    from_status: e.from_status,
    to_status: e.to_status,
    actor: e.actor_user_id ? optionalKeyOf(ctx, 'users', e.actor_user_id) : null,
    reason_code: e.reason_code,
    note: e.note,
    created_at: e.created_at,
  }),

  fromRow(cells, rowNo, ctx) {
    const parsed = parse('payment_submission_events', eventColumns, cells, rowNo, ctx);
    if ('errors' in parsed) return parsed;
    const { values: v, ids } = parsed;
    return {
      row: {
        id: v.id as string,
        submission_id: ids.submission as string,
        from_status: v.from_status as PaymentSubmissionStatus | null,
        to_status: v.to_status as PaymentSubmissionStatus,
        actor_user_id: ids.actor as string | null,
        reason_code: (v.reason_code as string | null) ?? null,
        note: (v.note as string | null) ?? null,
        created_at: (v.created_at as string | null) ?? null,
      },
    };
  },

  keyOf: (x) => x.id,

  // History is never edited: an event already in the school is left exactly as it is.
  diffFields: () => [],

  async upsert(row, existing, tenantId, m) {
    if (existing) return existing;
    const e = await newWithId(PaymentSubmissionEvent, row.id, tenantId, m);
    e.submission_id = row.submission_id;
    e.from_status = row.from_status;
    e.to_status = row.to_status;
    e.actor_user_id = row.actor_user_id;
    e.reason_code = row.reason_code;
    e.note = row.note;
    if (row.created_at) e.created_at = new Date(row.created_at);
    // insert only, never save(): the entity is append-only (see its docstring).
    await m.insert(PaymentSubmissionEvent, e);
    return e;
  },

  async remove() {
    throw new Error('Payment submission events are append-only and cannot be deleted.');
  },
};
