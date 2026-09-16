import type { EntityManager } from 'typeorm';
import { Invoice } from '../../../invoices/entities/invoice.entity';
import { fromCell, formatDateOnly } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';
import { InvoiceKind, InvoiceStatus, PaymentMethod } from '@biddaloy/shared';

/** [outside-diff fix] The `json` column type only checks JSON *syntax*
 * (`cell-format.ts`'s `fromCell`) — it has no idea `snapshot` must be an
 * `InvoiceSnapshot`. Without this, a malformed or empty (`{}`) snapshot
 * passes import and throws a `TypeError` later, in family DTO conversion
 * or print rendering, once something dereferences a missing field. */
function isValidInvoiceSnapshot(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const issuer = v.issuer as Record<string, unknown> | undefined;
  if (typeof issuer !== 'object' || issuer === null) return false;
  if (typeof issuer.name !== 'string' || typeof issuer.captured_at !== 'string') return false;
  if (!Array.isArray(v.students)) return false;
  const totals = v.totals as Record<string, unknown> | undefined;
  if (typeof totals !== 'object' || totals === null) return false;
  if (
    typeof totals.billed !== 'number' ||
    typeof totals.discount !== 'number' ||
    typeof totals.paid !== 'number'
  ) {
    return false;
  }
  const payment = v.payment as Record<string, unknown> | undefined;
  if (typeof payment !== 'object' || payment === null) return false;
  if (!Object.values(PaymentMethod).includes(payment.method as PaymentMethod)) return false;
  return true;
}

/**
 * `invoices` tab: official invoice document (or credit note) issued for
 * a student's fee payment.
 *
 * `student` is a `ref` against `students` tab and `issued_by` a `ref`
 * against `users`; both live in `tabs/people/` and both are listed in
 * `dependsOn`, so registry applies them before this tab.
 *
 * `issuer_snapshot` in `excluded`: restore never carries frozen
 * issuer identity forward. `upsert` always sets it `null` on insert,
 * reads of `null` snapshot fall back to live school profile (D9 of #508)
 * — so a restored invoice never gets stuck showing a stale, unreadable
 * snapshot from the source tenant.
 *
 * [16.5.1] `payment_id` / `related_invoice_id` are in `excluded`: both are
 * `ref`-shaped FKs, but their target tabs (`payments`, and `invoices`
 * itself for the credit-note case) sit at or after this tab's own
 * position in `EXPECTED_TABS` — `payments` strictly after, so a `ref`
 * column pointing at it would resolve against a `KeyIndex` that doesn't
 * exist yet at import time (the registry's own ref-ordering check would
 * reject it). Rather than reorder the whole fees group around a
 * backup/restore concern, these two ids are treated as opaque and dropped
 * on restore — same tradeoff already made for `payments.tab.ts`'s
 * checkout/reversal columns.
 *
 * Cost of dropping them (flagged in PR review, kept as a known gap rather
 * than fixed here): a restored invoice's `payment_id`/`related_invoice_id`
 * are always `null`, so `createFromPayment`'s payment→invoice idempotency
 * check, the credit-note→original-invoice link, and any print/read path
 * that joins through those columns stop working for a restored invoice —
 * the frozen `snapshot` (kept, see `issuer_snapshot` above) still renders
 * correctly on its own. Fixing this needs a genuine second import pass —
 * one that runs after every tab in `EXPECTED_TABS` has loaded and its
 * `KeyIndex` is populated, then resolves `payment`/`related_invoice`
 * `ref`s and `UPDATE`s the two columns directly — which no tab in this
 * registry does today (`ALL_TABS` is a single ordered pass). Tracked as a
 * follow-up rather than built here: #773.
 *
 * [16.5.1] Once an invoice's `status` leaves `DRAFT`, the DB trigger from
 * `1789800008000-InvoiceImmutableSnapshot` only allows `status`,
 * `updated_at`, `deleted_at` to change on that row (see class doc on
 * `Invoice`). `create()` always issues `status = ISSUED` immediately, so
 * in practice every restored row is already non-DRAFT; `upsert` below
 * only ever full-column-writes a still-DRAFT existing row (or inserts a
 * brand-new one), and for anything else only touches `status`.
 */

export interface InvoiceRow {
  id: string;
  invoice_number: string;
  kind: InvoiceKind;
  student_id: string;
  student_key: string;
  total_amount: string;
  tax_amount: string;
  discount_amount: string;
  status: InvoiceStatus;
  issued_date: string;
  due_date: string;
  snapshot: unknown;
  issued_by_id: string | null;
  issued_by_key: string | null;
  notes: string | null;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  {
    key: 'invoice_number',
    type: 'string',
    required: true,
    label: { en: 'Invoice number', bn: 'চালান নম্বর' },
  },
  {
    key: 'kind',
    type: 'enum',
    required: true,
    enumValues: Object.values(InvoiceKind),
    label: { en: 'Kind', bn: 'ধরন' },
  },
  {
    key: 'student',
    type: 'ref',
    ref: 'students',
    required: true,
    label: { en: 'Student', bn: 'শিক্ষার্থী' },
  },
  {
    key: 'total_amount',
    type: 'money',
    required: true,
    label: { en: 'Total amount', bn: 'মোট পরিমাণ' },
  },
  { key: 'tax_amount', type: 'money', required: true, label: { en: 'Tax amount', bn: 'কর' } },
  {
    key: 'discount_amount',
    type: 'money',
    required: true,
    label: { en: 'Discount amount', bn: 'ছাড়ের পরিমাণ' },
  },
  {
    key: 'status',
    type: 'enum',
    required: true,
    enumValues: Object.values(InvoiceStatus),
    label: { en: 'Status', bn: 'অবস্থা' },
  },
  {
    key: 'issued_date',
    type: 'date',
    required: true,
    label: { en: 'Issued date', bn: 'ইস্যুর তারিখ' },
  },
  { key: 'due_date', type: 'date', required: true, label: { en: 'Due date', bn: 'শেষ তারিখ' } },
  { key: 'snapshot', type: 'json', required: true, label: { en: 'Snapshot', bn: 'স্ন্যাপশট' } },
  {
    key: 'issued_by',
    type: 'ref',
    ref: 'users',
    label: { en: 'Issued by', bn: 'ইস্যুকারী' },
  },
  { key: 'notes', type: 'string', label: { en: 'Notes', bn: 'মন্তব্য' } },
];

const excluded: readonly string[] = [
  'student_id', // exported instead as `student` ref column
  'issued_by_user_id', // exported instead as `issued_by` ref column
  // [16.5.1] Opaque FKs whose target tab would need to be applied before
  // this one for a `ref` column to resolve — see file doc comment above.
  'payment_id',
  'related_invoice_id',
  // Frozen issuer identity at issue time. A restore never carries it
  // forward; null snapshot falls back to the live school profile (D9 of
  // #508).
  'issuer_snapshot',
];

export const invoicesTab: TabSpec<Invoice, InvoiceRow> = {
  name: 'invoices',
  entity: Invoice,
  excluded,
  dependsOn: ['students', 'users'],
  columns,
  naturalKey: ['invoice_number'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<Invoice[]> {
    // `Invoice` carries no `tenant_id` of its own — tenancy is filtered
    // through `student`, same as `InvoicesService.findAll`.
    return m.find(Invoice, {
      where: { student: { tenant_id: tenantId } },
      relations: ['student'],
    });
  },

  toRow(entity: Invoice, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      invoice_number: entity.invoice_number,
      kind: entity.kind,
      student: ctx.keyOf('students', entity.student_id),
      total_amount: entity.total_amount,
      tax_amount: entity.tax_amount,
      discount_amount: entity.discount_amount,
      status: entity.status,
      issued_date: entity.issued_date,
      due_date: entity.due_date,
      snapshot: entity.snapshot,
      issued_by: entity.issued_by_user_id ? ctx.keyOf('users', entity.issued_by_user_id) : null,
      notes: entity.notes,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: InvoiceRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'invoices', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }
      values[column.key] = result.value;
    }

    if (errors.length > 0) return { errors };

    if (!isValidInvoiceSnapshot(values.snapshot)) {
      errors.push({
        tab: 'invoices',
        row: rowNo,
        column: 'snapshot',
        message:
          'Column "snapshot": does not match the required InvoiceSnapshot shape (issuer, students, totals, payment).',
        severity: 'error',
        value: cells.snapshot,
      });
    }

    let studentId: string | undefined;
    const studentKey = values.student as string;
    if (studentKey) {
      studentId = ctx.ref('students', studentKey);
      if (!studentId) {
        errors.push({
          tab: 'invoices',
          row: rowNo,
          column: 'student',
          message: `Column "student": no student with registration number "${studentKey}" found.`,
          severity: 'error',
          value: studentKey,
        });
      }
    }

    let issuedById: string | undefined;
    const issuedByKey = (values.issued_by as string) || undefined;
    if (issuedByKey) {
      const resolved = ctx.ref('users', issuedByKey);
      if (!resolved) {
        errors.push({
          tab: 'invoices',
          row: rowNo,
          column: 'issued_by',
          message: `Column "issued_by": no user "${issuedByKey}" found.`,
          severity: 'error',
          value: issuedByKey,
        });
      } else {
        issuedById = resolved;
      }
    }

    if (errors.length > 0) return { errors };

    return {
      row: {
        id: values.id as string,
        invoice_number: values.invoice_number as string,
        kind: values.kind as InvoiceKind,
        student_id: studentId as string,
        student_key: studentKey,
        total_amount: values.total_amount as string,
        tax_amount: values.tax_amount as string,
        discount_amount: values.discount_amount as string,
        status: values.status as InvoiceStatus,
        issued_date: values.issued_date as string,
        due_date: values.due_date as string,
        snapshot: values.snapshot ?? null,
        issued_by_id: issuedById ?? null,
        issued_by_key: issuedByKey ?? null,
        notes: (values.notes as string | null) ?? null,
      },
    };
  },

  keyOf(x: InvoiceRow | Invoice): string {
    return x.invoice_number;
  },

  diffFields(row: InvoiceRow, existing: Invoice): string[] {
    const changed: string[] = [];
    if (row.kind !== existing.kind) changed.push('kind');
    if (row.student_id !== existing.student_id) changed.push('student');
    if (String(row.total_amount) !== String(existing.total_amount)) changed.push('total_amount');
    if (String(row.tax_amount) !== String(existing.tax_amount)) changed.push('tax_amount');
    if (String(row.discount_amount) !== String(existing.discount_amount)) {
      changed.push('discount_amount');
    }
    if (row.status !== existing.status) changed.push('status');
    // Both `date` columns: `YYYY-MM-DD` on the row, `Date` on the entity.
    if (row.issued_date !== formatDateOnly(existing.issued_date)) changed.push('issued_date');
    if (row.due_date !== formatDateOnly(existing.due_date)) changed.push('due_date');
    if (JSON.stringify(row.snapshot) !== JSON.stringify(existing.snapshot)) {
      changed.push('snapshot');
    }
    if (row.issued_by_id !== existing.issued_by_user_id) changed.push('issued_by');
    if (row.notes !== existing.notes) changed.push('notes');
    return changed;
  },

  async upsert(row: InvoiceRow, existing: Invoice | null, tenantId: string, m: EntityManager) {
    // [16.5.1] D21 immutability trigger: once an existing row's status has
    // left DRAFT, the DB only permits status/updated_at/deleted_at to
    // change — a full-column UPDATE on an already-ISSUED (or later)
    // invoice would be rejected by the trigger. So for those rows, only
    // carry the status forward; every other field (student, amounts,
    // snapshot, ...) is left untouched, matching what's already on disk.
    if (existing !== null && existing.status !== InvoiceStatus.DRAFT) {
      // [16.5.1 fix] The trigger only blocks non-status columns once a row
      // has left DRAFT — it does not stop `status` itself from being set
      // back to DRAFT. A restore row that tries to re-enter DRAFT on an
      // already-issued invoice would silently resurrect a "draft" that has
      // a frozen snapshot and (usually) a real payment behind it. Reject
      // that transition instead of applying it.
      if (row.status === InvoiceStatus.DRAFT) {
        throw new Error(
          `Cannot restore invoice ${row.invoice_number} to DRAFT: it is already ${existing.status}.`,
        );
      }
      existing.status = row.status;
      return m.save(Invoice, existing);
    }

    const invoice = existing ?? new Invoice();
    invoice.invoice_number = row.invoice_number;
    invoice.kind = row.kind;
    invoice.student_id = row.student_id;
    invoice.total_amount = row.total_amount as unknown as number;
    invoice.tax_amount = row.tax_amount as unknown as number;
    invoice.discount_amount = row.discount_amount as unknown as number;
    invoice.status = row.status;
    invoice.issued_date = row.issued_date as unknown as Date;
    invoice.due_date = row.due_date as unknown as Date;
    invoice.snapshot = row.snapshot as Invoice['snapshot'];
    invoice.issued_by_user_id = row.issued_by_id;
    invoice.notes = row.notes;
    // Never carried forward from the source tenant's snapshot; null
    // snapshot falls back to the live school profile on read (D9 of #508).
    // Only on insert: an existing invoice's `issuer_snapshot` is issuer
    // identity frozen at issue time, nulling it on a same-school restore
    // would silently repoint every reprinted receipt at the current profile.
    if (existing === null) invoice.issuer_snapshot = null;

    return m.save(Invoice, invoice);
  },

  async remove(entity: Invoice, m: EntityManager): Promise<void> {
    await m.softRemove(Invoice, entity);
  },
};
