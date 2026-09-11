import type { EntityManager } from 'typeorm';
import { Invoice } from '../../../invoices/entities/invoice.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';
import { InvoiceStatus } from '@biddaloy/shared';

/**
 * The `invoices` tab: the official invoice document issued for a student's
 * fee payment.
 *
 * `student` is a **forward reference** to the not-yet-existing `students`
 * tab (14.5, a different parallel group) — see `fee-structures.tab.ts` for
 * the full explanation of that pattern. `issued_by` is a `ref` against
 * `users`, which is *also* a forward reference: `EXPECTED_TABS`
 * (registry.ts) lists `users` as a core tab, but no group has landed
 * `tabs/people/users.tab.ts` in this worktree yet either. Both refs are
 * written exactly as they will resolve once their tabs exist.
 *
 * `issuer_snapshot` is in `excluded`: a restore never carries the frozen
 * issuer identity forward. `upsert` always sets it to `null`, and reads of
 * a `null` snapshot fall back to the live school profile (D9 of #508) — so a
 * restored invoice is never stuck showing a stale, unreadable snapshot from
 * the source tenant.
 */

export interface InvoiceRow {
  id: string;
  invoice_number: string;
  student_id: string;
  student_key: string;
  student_fee_id: string | null;
  student_fee_key: string | null;
  total_amount: string;
  tax_amount: string;
  discount_amount: string;
  status: InvoiceStatus;
  issued_date: string;
  due_date: string;
  line_items: unknown;
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
    key: 'student',
    type: 'ref',
    ref: 'students',
    required: true,
    label: { en: 'Student', bn: 'শিক্ষার্থী' },
  },
  {
    key: 'student_fee',
    type: 'ref',
    ref: 'student_fees',
    label: { en: 'Student fee', bn: 'শিক্ষার্থীর ফি' },
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
  { key: 'issued_date', type: 'date', required: true, label: { en: 'Issued date', bn: 'ইস্যুর তারিখ' } },
  { key: 'due_date', type: 'date', required: true, label: { en: 'Due date', bn: 'শেষ তারিখ' } },
  { key: 'line_items', type: 'json', label: { en: 'Line items', bn: 'লাইন আইটেম' } },
  {
    key: 'issued_by',
    type: 'ref',
    ref: 'users',
    label: { en: 'Issued by', bn: 'ইস্যুকারী' },
  },
  { key: 'notes', type: 'string', label: { en: 'Notes', bn: 'মন্তব্য' } },
];

const excluded: readonly string[] = [
  'student_id', // exported instead as the `student` ref column
  'student_fee_id', // exported instead as the `student_fee` ref column
  'issued_by_user_id', // exported instead as the `issued_by` ref column
  // Frozen issuer identity at issue time. A restore never carries this
  // forward: upsert sets it to null, and a null snapshot falls back to the
  // live school profile on read (D9 of #508).
  'issuer_snapshot',
];

export const invoicesTab: TabSpec<Invoice, InvoiceRow> = {
  name: 'invoices',
  entity: Invoice,
  excluded,
  dependsOn: ['students', 'student_fees', 'users'],
  columns,
  naturalKey: ['invoice_number'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<Invoice[]> {
    // `Invoice` carries no `tenant_id` of its own — tenancy is filtered
    // through `student`, same as `InvoicesService.findAll`.
    // `toRow` only ever reads `*_id` foreign keys (through `ctx.keyOf`), not
    // the `student_fee`/`issued_by` relations themselves, so only `student`
    // is loaded eagerly — it's the one needed to filter by tenant.
    return m.find(Invoice, {
      where: { student: { tenant_id: tenantId } },
      relations: ['student'],
    });
  },

  toRow(entity: Invoice, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      invoice_number: entity.invoice_number,
      student: ctx.keyOf('students', entity.student_id),
      student_fee: entity.student_fee_id ? ctx.keyOf('student_fees', entity.student_fee_id) : null,
      total_amount: entity.total_amount,
      tax_amount: entity.tax_amount,
      discount_amount: entity.discount_amount,
      status: entity.status,
      issued_date: entity.issued_date,
      due_date: entity.due_date,
      line_items: entity.line_items,
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

    let studentId: string | undefined;
    const studentKey = values.student as string;
    if (studentKey) {
      studentId = ctx.ref('students', studentKey);
      if (!studentId) {
        errors.push({
          tab: 'invoices',
          row: rowNo,
          column: 'student',
          message: `Column "student": no student with registration number "${studentKey}" was found.`,
          severity: 'error',
          value: studentKey,
        });
      }
    }

    let studentFeeId: string | null = null;
    const studentFeeKey = (values.student_fee as string | null) ?? null;
    if (studentFeeKey) {
      const resolved = ctx.ref('student_fees', studentFeeKey);
      if (!resolved) {
        errors.push({
          tab: 'invoices',
          row: rowNo,
          column: 'student_fee',
          message: `Column "student_fee": no student fee "${studentFeeKey}" was found.`,
          severity: 'error',
          value: studentFeeKey,
        });
      } else {
        studentFeeId = resolved;
      }
    }

    let issuedById: string | null = null;
    const issuedByKey = (values.issued_by as string | null) ?? null;
    if (issuedByKey) {
      const resolved = ctx.ref('users', issuedByKey);
      if (!resolved) {
        errors.push({
          tab: 'invoices',
          row: rowNo,
          column: 'issued_by',
          message: `Column "issued_by": no user "${issuedByKey}" was found.`,
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
        student_id: studentId as string,
        student_key: studentKey,
        student_fee_id: studentFeeId,
        student_fee_key: studentFeeKey,
        total_amount: values.total_amount as string,
        tax_amount: values.tax_amount as string,
        discount_amount: values.discount_amount as string,
        status: values.status as InvoiceStatus,
        issued_date: values.issued_date as string,
        due_date: values.due_date as string,
        line_items: values.line_items ?? null,
        issued_by_id: issuedById,
        issued_by_key: issuedByKey,
        notes: (values.notes as string | null) ?? null,
      },
    };
  },

  keyOf(x: InvoiceRow | Invoice): string {
    return x.invoice_number;
  },

  diffFields(row: InvoiceRow, existing: Invoice): string[] {
    const changed: string[] = [];
    if (row.student_id !== existing.student_id) changed.push('student');
    if (row.student_fee_id !== existing.student_fee_id) changed.push('student_fee');
    if (String(row.total_amount) !== String(existing.total_amount)) changed.push('total_amount');
    if (String(row.tax_amount) !== String(existing.tax_amount)) changed.push('tax_amount');
    if (String(row.discount_amount) !== String(existing.discount_amount)) {
      changed.push('discount_amount');
    }
    if (row.status !== existing.status) changed.push('status');
    if (String(row.issued_date) !== String(existing.issued_date)) changed.push('issued_date');
    if (String(row.due_date) !== String(existing.due_date)) changed.push('due_date');
    if (JSON.stringify(row.line_items) !== JSON.stringify(existing.line_items)) {
      changed.push('line_items');
    }
    if (row.issued_by_id !== existing.issued_by_user_id) changed.push('issued_by');
    if (row.notes !== existing.notes) changed.push('notes');
    return changed;
  },

  async upsert(
    row: InvoiceRow,
    existing: Invoice | null,
    _tenantId: string,
    m: EntityManager,
  ): Promise<Invoice> {
    const invoice = existing ?? new Invoice();
    invoice.invoice_number = row.invoice_number;
    invoice.student_id = row.student_id;
    invoice.student_fee_id = row.student_fee_id;
    invoice.total_amount = row.total_amount as unknown as number;
    invoice.tax_amount = row.tax_amount as unknown as number;
    invoice.discount_amount = row.discount_amount as unknown as number;
    invoice.status = row.status;
    invoice.issued_date = row.issued_date as unknown as Date;
    invoice.due_date = row.due_date as unknown as Date;
    invoice.line_items = row.line_items as Invoice['line_items'];
    invoice.issued_by_user_id = row.issued_by_id;
    invoice.notes = row.notes;
    // Never carried forward from the source tenant's snapshot; a null
    // snapshot falls back to the live school profile on read (D9 of #508).
    invoice.issuer_snapshot = null;

    return m.save(Invoice, invoice);
  },

  async remove(entity: Invoice, m: EntityManager): Promise<void> {
    await m.softRemove(Invoice, entity);
  },
};
