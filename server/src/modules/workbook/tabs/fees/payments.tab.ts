import type { EntityManager } from 'typeorm';
import { Payment } from '../../../fees/entities/payment.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';
import { PaymentMethod, PaymentStatus } from '@biddaloy/shared';

/**
 * The `payments` tab: a financial transaction recorded against a student.
 *
 * `student` and `received_by`/`invoice` are `ref` columns; `student` is a
 * **forward reference** to the not-yet-existing `students` tab (14.5, a
 * different parallel group) — see `fee-structures.tab.ts` for the full
 * explanation. `received_by` refs the (also not-yet-landed) `users` tab.
 *
 * `naturalKey` prefers `transaction_reference` (per the ticket table), but a
 * cash payment often has none. Per the ticket, `keyOf` falls back to
 * `student|payment_date|total_amount|payment_method` in that case — a weak
 * key that can collide (two identical cash payments on the same day) — so
 * `fromRow` raises a `ctx.warn` naming that risk rather than silently
 * treating the fallback as fully reliable.
 */

export interface PaymentRow {
  id: string;
  student_id: string;
  student_key: string;
  total_amount: string;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  transaction_reference: string | null;
  remarks: string | null;
  received_by_id: string | null;
  received_by_key: string | null;
  invoice_id: string | null;
  invoice_key: string | null;
  payment_date: string;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
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
  {
    key: 'payment_method',
    type: 'enum',
    required: true,
    enumValues: Object.values(PaymentMethod),
    label: { en: 'Payment method', bn: 'পরিশোধ পদ্ধতি' },
  },
  {
    key: 'payment_status',
    type: 'enum',
    required: true,
    enumValues: Object.values(PaymentStatus),
    label: { en: 'Payment status', bn: 'পরিশোধ অবস্থা' },
  },
  {
    key: 'transaction_reference',
    type: 'string',
    label: { en: 'Transaction reference', bn: 'লেনদেন রেফারেন্স' },
  },
  { key: 'remarks', type: 'string', label: { en: 'Remarks', bn: 'মন্তব্য' } },
  {
    key: 'received_by',
    type: 'ref',
    ref: 'users',
    label: { en: 'Received by', bn: 'গ্রহণকারী' },
  },
  {
    key: 'invoice',
    type: 'ref',
    ref: 'invoices',
    label: { en: 'Invoice', bn: 'চালান' },
  },
  {
    key: 'payment_date',
    type: 'datetime',
    required: true,
    label: { en: 'Payment date', bn: 'পরিশোধের তারিখ' },
  },
];

const excluded: readonly string[] = [
  'student_id', // exported instead as the `student` ref column
  'received_by_user_id', // exported instead as the `received_by` ref column
  'invoice_id', // exported instead as the `invoice` ref column
  // `allocations` is a relation, not a column (the completeness gate only
  // walks `dataSource.getMetadata(entity).columns`), so it needs no entry
  // here — it's exported by the separate `payment_allocations` tab.
  // Frozen issuer identity at record time. Same reason as `invoices.tab.ts`:
  // a restore never carries this forward; a null snapshot falls back to the
  // live school profile on read (D9 of #508).
  'issuer_snapshot',
];

export const paymentsTab: TabSpec<Payment, PaymentRow> = {
  name: 'payments',
  entity: Payment,
  excluded,
  dependsOn: ['students', 'invoices', 'users'],
  columns,
  naturalKey: ['transaction_reference'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<Payment[]> {
    return m.find(Payment, {
      where: { tenant_id: tenantId },
      relations: ['student', 'received_by', 'invoice'],
    });
  },

  toRow(entity: Payment, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      student: ctx.keyOf('students', entity.student_id),
      total_amount: entity.total_amount,
      payment_method: entity.payment_method,
      payment_status: entity.payment_status,
      transaction_reference: entity.transaction_reference,
      remarks: entity.remarks,
      received_by: entity.received_by_user_id
        ? ctx.keyOf('users', entity.received_by_user_id)
        : null,
      invoice: entity.invoice_id ? ctx.keyOf('invoices', entity.invoice_id) : null,
      payment_date: entity.payment_date,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: PaymentRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'payments', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }
      values[column.key] = result.value;
    }

    if (errors.length > 0) return { errors };

    let studentId: string | undefined;
    const studentKey = values.student as string;
    if (studentKey) {
      studentId = ctx.ref('students', studentKey);
      if (!studentId) {
        errors.push({
          tab: 'payments',
          row: rowNo,
          column: 'student',
          message: `Column "student": no student with registration number "${studentKey}" was found.`,
          severity: 'error',
          value: studentKey,
        });
      }
    }

    let receivedById: string | null = null;
    const receivedByKey = (values.received_by as string | null) ?? null;
    if (receivedByKey) {
      const resolved = ctx.ref('users', receivedByKey);
      if (!resolved) {
        errors.push({
          tab: 'payments',
          row: rowNo,
          column: 'received_by',
          message: `Column "received_by": no user "${receivedByKey}" was found.`,
          severity: 'error',
          value: receivedByKey,
        });
      } else {
        receivedById = resolved;
      }
    }

    let invoiceId: string | null = null;
    const invoiceKey = (values.invoice as string | null) ?? null;
    if (invoiceKey) {
      const resolved = ctx.ref('invoices', invoiceKey);
      if (!resolved) {
        errors.push({
          tab: 'payments',
          row: rowNo,
          column: 'invoice',
          message: `Column "invoice": no invoice numbered "${invoiceKey}" was found.`,
          severity: 'error',
          value: invoiceKey,
        });
      } else {
        invoiceId = resolved;
      }
    }

    if (errors.length > 0) return { errors };

    const transactionReference = (values.transaction_reference as string | null) ?? null;
    if (!transactionReference) {
      // Per the ticket: the fallback key (student|payment_date|total_amount|
      // payment_method) is weak — two identical cash payments on the same
      // day collide. Warn rather than silently trusting it.
      ctx.warn({
        tab: 'payments',
        row: rowNo,
        column: 'transaction_reference',
        message:
          'Column "transaction_reference": is empty, so this row is matched by a weaker fallback ' +
          'key (student, payment date, amount, method) — keep the id column to avoid ambiguous matches.',
        severity: 'warning',
      });
    }

    return {
      row: {
        id: values.id as string,
        student_id: studentId as string,
        student_key: studentKey,
        total_amount: values.total_amount as string,
        payment_method: values.payment_method as PaymentMethod,
        payment_status: values.payment_status as PaymentStatus,
        transaction_reference: transactionReference,
        remarks: (values.remarks as string | null) ?? null,
        received_by_id: receivedById,
        received_by_key: receivedByKey,
        invoice_id: invoiceId,
        invoice_key: invoiceKey,
        payment_date: values.payment_date as string,
      },
    };
  },

  keyOf(x: PaymentRow | Payment): string {
    if (x.transaction_reference) return x.transaction_reference;

    // Weak fallback key — see the file doc comment and the ctx.warn above.
    // The student half is the real `registration_number`, not a uuid, on
    // both branches: `load()` eager-loads `student`, so an entity reads it
    // straight off the real `Student` entity (same pattern as
    // `student-fees.tab.ts`'s own keyOf) rather than the not-yet-existing
    // `students` tab, and a row already carries that text from `fromRow`.
    // This keeps `keyOf(entity) === keyOf(row)` for the same logical
    // payment even without `transaction_reference` — without it, a
    // re-import of a cash payment would never match its existing row and
    // would insert a duplicate on every restore instead of updating it.
    const studentKey = x instanceof Payment ? (x.student?.registration_number ?? '') : x.student_key;
    return `${studentKey}|${x.payment_date}|${x.total_amount}|${x.payment_method}`;
  },

  diffFields(row: PaymentRow, existing: Payment): string[] {
    const changed: string[] = [];
    if (row.student_id !== existing.student_id) changed.push('student');
    if (String(row.total_amount) !== String(existing.total_amount)) changed.push('total_amount');
    if (row.payment_method !== existing.payment_method) changed.push('payment_method');
    if (row.payment_status !== existing.payment_status) changed.push('payment_status');
    if (row.transaction_reference !== existing.transaction_reference) {
      changed.push('transaction_reference');
    }
    if (row.remarks !== existing.remarks) changed.push('remarks');
    if (row.received_by_id !== existing.received_by_user_id) changed.push('received_by');
    if (row.invoice_id !== existing.invoice_id) changed.push('invoice');
    if (String(row.payment_date) !== String(existing.payment_date)) changed.push('payment_date');
    return changed;
  },

  async upsert(
    row: PaymentRow,
    existing: Payment | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<Payment> {
    const payment = existing ?? new Payment();
    payment.tenant_id = tenantId;
    payment.student_id = row.student_id;
    payment.total_amount = row.total_amount as unknown as number;
    payment.payment_method = row.payment_method;
    payment.payment_status = row.payment_status;
    payment.transaction_reference = row.transaction_reference;
    payment.remarks = row.remarks;
    payment.received_by_user_id = row.received_by_id;
    payment.invoice_id = row.invoice_id;
    payment.payment_date = row.payment_date as unknown as Date;
    // Never carried forward from the source tenant's snapshot; see
    // `invoices.tab.ts` for the same rule and D9 of #508.
    payment.issuer_snapshot = null;

    return m.save(Payment, payment);
  },

  async remove(entity: Payment, m: EntityManager): Promise<void> {
    await m.softRemove(Payment, entity);
  },
};
