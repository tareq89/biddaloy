import type { EntityManager } from 'typeorm';
import { QueryFailedError } from 'typeorm';
import { PaymentAllocation } from '../../../fees/entities/payment-allocation.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';
import { PaymentAllocationType } from '@biddaloy/shared';
import { paymentsTab } from './payments.tab';
import { studentFeesTab } from './student-fees.tab';

/**
 * The `payment_allocations` tab: how one payment is split across one or more
 * fee periods.
 *
 * Both refs (`payment`, `student_fee`) resolve within this same lane.
 * `PaymentAllocation`
 * has no `deleted_at` (see the entity), so `remove` hard-deletes; there is no
 * downstream table referencing it, so no FK-violation handling is needed the
 * way `student_fees.tab.ts` needs one for payments.
 */

export interface PaymentAllocationRow {
  id: string;
  payment_id: string;
  payment_key: string;
  student_fee_id: string;
  student_fee_key: string;
  allocated_amount: string;
  allocation_type: PaymentAllocationType;
  notes: string | null;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  {
    key: 'payment',
    type: 'ref',
    ref: 'payments',
    required: true,
    label: { en: 'Payment', bn: 'পরিশোধ' },
  },
  {
    key: 'student_fee',
    type: 'ref',
    ref: 'student_fees',
    required: true,
    label: { en: 'Student fee', bn: 'শিক্ষার্থীর ফি' },
  },
  {
    key: 'allocated_amount',
    type: 'money',
    required: true,
    label: { en: 'Allocated amount', bn: 'বরাদ্দকৃত পরিমাণ' },
  },
  {
    key: 'allocation_type',
    type: 'enum',
    required: true,
    enumValues: Object.values(PaymentAllocationType),
    label: { en: 'Allocation type', bn: 'বরাদ্দের ধরন' },
  },
  { key: 'notes', type: 'string', label: { en: 'Notes', bn: 'মন্তব্য' } },
];

const excluded: readonly string[] = [
  'payment_id', // exported instead as the `payment` ref column
  'student_fee_id', // exported instead as the `student_fee` ref column
];

/** Postgres error code for a foreign-key violation. */
const FK_VIOLATION = '23503';

export const paymentAllocationsTab: TabSpec<PaymentAllocation, PaymentAllocationRow> = {
  name: 'payment_allocations',
  entity: PaymentAllocation,
  excluded,
  dependsOn: ['payments', 'student_fees'],
  columns,
  naturalKey: ['payment', 'student_fee'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<PaymentAllocation[]> {
    // `PaymentAllocation` carries no `tenant_id` of its own — tenancy is
    // filtered through its `payment` relation, which is loaded eagerly (with
    // its own `student`, since `paymentsTab.keyOf` needs it for the
    // transaction-reference fallback) so `keyOf` never re-queries.
    return m.find(PaymentAllocation, {
      where: { payment: { tenant_id: tenantId } },
      relations: [
        'payment',
        // `paymentsTab.keyOf` needs `payment.student` for its fallback key
        // (see payments.tab.ts) — loaded here too so this tab's own keyOf
        // never silently falls back to an empty string.
        'payment.student',
        'student_fee',
        'student_fee.student',
        'student_fee.academic_year',
      ],
    });
  },

  toRow(entity: PaymentAllocation, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      payment: ctx.keyOf('payments', entity.payment_id),
      student_fee: ctx.keyOf('student_fees', entity.student_fee_id),
      allocated_amount: entity.allocated_amount,
      allocation_type: entity.allocation_type,
      notes: entity.notes,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: PaymentAllocationRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'payment_allocations', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }
      values[column.key] = result.value;
    }

    if (errors.length > 0) return { errors };

    let paymentId: string | undefined;
    const paymentKey = values.payment as string;
    if (paymentKey) {
      paymentId = ctx.ref('payments', paymentKey);
      if (!paymentId) {
        errors.push({
          tab: 'payment_allocations',
          row: rowNo,
          column: 'payment',
          message: `Column "payment": no payment "${paymentKey}" was found.`,
          severity: 'error',
          value: paymentKey,
        });
      }
    }

    let studentFeeId: string | undefined;
    const studentFeeKey = values.student_fee as string;
    if (studentFeeKey) {
      studentFeeId = ctx.ref('student_fees', studentFeeKey);
      if (!studentFeeId) {
        errors.push({
          tab: 'payment_allocations',
          row: rowNo,
          column: 'student_fee',
          message: `Column "student_fee": no student fee "${studentFeeKey}" was found.`,
          severity: 'error',
          value: studentFeeKey,
        });
      }
    }

    if (errors.length > 0) return { errors };

    return {
      row: {
        id: values.id as string,
        payment_id: paymentId as string,
        payment_key: paymentKey,
        student_fee_id: studentFeeId as string,
        student_fee_key: studentFeeKey,
        allocated_amount: values.allocated_amount as string,
        allocation_type: values.allocation_type as PaymentAllocationType,
        notes: (values.notes as string | null) ?? null,
      },
    };
  },

  keyOf(x: PaymentAllocationRow | PaymentAllocation): string {
    // Delegates to `paymentsTab.keyOf`/`studentFeesTab.keyOf` for the entity
    // branch, same pattern as every other cross-tab ref in this lane, so
    // neither half of the key can drift from how its own tab builds it
    // (including `payments`' transaction_reference-or-fallback rule).
    // Guarded like every other cross-tab delegation in this lane: `m.save`
    // returns an entity carrying only the assigned scalars, so calling this
    // on an `upsert` result would otherwise throw on the unloaded relation.
    const paymentKey =
      x instanceof PaymentAllocation
        ? x.payment
          ? paymentsTab.keyOf(x.payment)
          : ''
        : x.payment_key;
    const studentFeeKey =
      x instanceof PaymentAllocation
        ? x.student_fee
          ? studentFeesTab.keyOf(x.student_fee)
          : ''
        : x.student_fee_key;
    return `${paymentKey}|${studentFeeKey}`;
  },

  diffFields(row: PaymentAllocationRow, existing: PaymentAllocation): string[] {
    const changed: string[] = [];
    if (row.payment_id !== existing.payment_id) changed.push('payment');
    if (row.student_fee_id !== existing.student_fee_id) changed.push('student_fee');
    if (String(row.allocated_amount) !== String(existing.allocated_amount)) {
      changed.push('allocated_amount');
    }
    if (row.allocation_type !== existing.allocation_type) changed.push('allocation_type');
    if (row.notes !== existing.notes) changed.push('notes');
    return changed;
  },

  async upsert(
    row: PaymentAllocationRow,
    existing: PaymentAllocation | null,
    _tenantId: string,
    m: EntityManager,
  ): Promise<PaymentAllocation> {
    const allocation = existing ?? new PaymentAllocation();
    allocation.payment_id = row.payment_id;
    allocation.student_fee_id = row.student_fee_id;
    allocation.allocated_amount = row.allocated_amount as unknown as number;
    allocation.allocation_type = row.allocation_type;
    allocation.notes = row.notes;

    return m.save(PaymentAllocation, allocation);
  },

  async remove(entity: PaymentAllocation, m: EntityManager): Promise<void> {
    try {
      await m.delete(PaymentAllocation, { id: entity.id });
    } catch (e) {
      if (e instanceof QueryFailedError && (e as { code?: string }).code === FK_VIOLATION) {
        throw new Error(`Cannot delete payment allocation ${entity.id}: it is still referenced.`);
      }
      throw e;
    }
  },
};
