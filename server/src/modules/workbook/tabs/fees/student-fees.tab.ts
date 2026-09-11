import type { EntityManager } from 'typeorm';
import { QueryFailedError } from 'typeorm';
import { StudentFee } from '../../../fees/entities/student-fee.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';
import { FeeStatus } from '@biddaloy/shared';
import { academicYearsTab } from '../academics/academic-years.tab';

/**
 * The `student_fees` tab: one student's fee obligation for one month.
 *
 * `student` is a `ref` column against the `students` tab — a **forward
 * reference** to a tab that lands from a different, parallel group (14.5)
 * and does not exist in this worktree. See `fee-structures.tab.ts` for the
 * full explanation; the same rule applies here: `ctx.ref`/`ctx.keyOf` are
 * written exactly as they will be once that tab lands, and this file's own
 * tests supply a fake context rather than depending on it.
 *
 * `StudentFee` has no `deleted_at` (see the entity), so `remove` hard-deletes.
 * A row still referenced by a `PaymentAllocation` fails that delete with
 * Postgres error `23503` (foreign_key_violation); `remove` catches that and
 * re-throws a clear message rather than letting the raw `QueryFailedError`
 * escape and abort the whole restore with an opaque driver error.
 */

export interface StudentFeeRow {
  id: string;
  student_id: string;
  student_key: string;
  academic_year_id: string;
  academic_year_key: string;
  month: number;
  year: number;
  total_amount: string;
  paid_amount: string;
  discount_amount: string;
  status: FeeStatus;
  due_date: string | null;
  reminder_threshold_date: string | null;
  is_advance_payment: boolean;
  original_advance_month: number | null;
  original_advance_year: number | null;
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
    key: 'academic_year',
    type: 'ref',
    ref: 'academic_years',
    required: true,
    label: { en: 'Academic year', bn: 'শিক্ষাবর্ষ' },
  },
  { key: 'month', type: 'int', required: true, label: { en: 'Month', bn: 'মাস' } },
  { key: 'year', type: 'int', required: true, label: { en: 'Year', bn: 'বছর' } },
  {
    key: 'total_amount',
    type: 'money',
    required: true,
    label: { en: 'Total amount', bn: 'মোট পরিমাণ' },
  },
  {
    key: 'paid_amount',
    type: 'money',
    required: true,
    label: { en: 'Paid amount', bn: 'পরিশোধিত পরিমাণ' },
  },
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
    enumValues: Object.values(FeeStatus),
    label: { en: 'Status', bn: 'অবস্থা' },
  },
  { key: 'due_date', type: 'date', label: { en: 'Due date', bn: 'শেষ তারিখ' } },
  {
    key: 'reminder_threshold_date',
    type: 'date',
    label: { en: 'Reminder threshold date', bn: 'অনুস্মারক তারিখ' },
  },
  {
    key: 'is_advance_payment',
    type: 'bool',
    required: true,
    label: { en: 'Advance payment', bn: 'অগ্রিম পরিশোধ' },
  },
  {
    key: 'original_advance_month',
    type: 'int',
    label: { en: 'Original advance month', bn: 'মূল অগ্রিম মাস' },
  },
  {
    key: 'original_advance_year',
    type: 'int',
    label: { en: 'Original advance year', bn: 'মূল অগ্রিম বছর' },
  },
];

const excluded: readonly string[] = [
  'student_id', // exported instead as the `student` ref column
  'academic_year_id', // exported instead as the `academic_year` ref column
];

/** Postgres error code for a foreign-key violation. */
const FK_VIOLATION = '23503';

export const studentFeesTab: TabSpec<StudentFee, StudentFeeRow> = {
  name: 'student_fees',
  entity: StudentFee,
  excluded,
  dependsOn: ['students', 'academic_years'],
  columns,
  naturalKey: ['student', 'academic_year', 'month', 'year'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<StudentFee[]> {
    // `StudentFee` carries no `tenant_id` of its own — tenancy is filtered
    // through its `student` relation, which is loaded eagerly (not through
    // the not-yet-existing `students` tab) both to filter by tenant and so
    // `keyOf` can read the student's own `registration_number` directly off
    // the real `Student` entity.
    return m.find(StudentFee, {
      where: { student: { tenant_id: tenantId } },
      relations: ['student', 'academic_year'],
    });
  },

  toRow(entity: StudentFee, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      student: ctx.keyOf('students', entity.student_id),
      academic_year: ctx.keyOf('academic_years', entity.academic_year_id),
      month: entity.month,
      year: entity.year,
      total_amount: entity.total_amount,
      paid_amount: entity.paid_amount,
      discount_amount: entity.discount_amount,
      status: entity.status,
      due_date: entity.due_date,
      reminder_threshold_date: entity.reminder_threshold_date,
      is_advance_payment: entity.is_advance_payment,
      original_advance_month: entity.original_advance_month,
      original_advance_year: entity.original_advance_year,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: StudentFeeRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'student_fees', rowNo);
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
          tab: 'student_fees',
          row: rowNo,
          column: 'student',
          message: `Column "student": no student with registration number "${studentKey}" was found.`,
          severity: 'error',
          value: studentKey,
        });
      }
    }

    let academicYearId: string | undefined;
    const academicYearKey = values.academic_year as string;
    if (academicYearKey) {
      academicYearId = ctx.ref('academic_years', academicYearKey);
      if (!academicYearId) {
        errors.push({
          tab: 'student_fees',
          row: rowNo,
          column: 'academic_year',
          message: `Column "academic_year": no academic year named "${academicYearKey}" was found.`,
          severity: 'error',
          value: academicYearKey,
        });
      }
    }

    if (errors.length > 0) return { errors };

    return {
      row: {
        id: values.id as string,
        student_id: studentId as string,
        student_key: studentKey,
        academic_year_id: academicYearId as string,
        academic_year_key: academicYearKey,
        month: values.month as number,
        year: values.year as number,
        total_amount: values.total_amount as string,
        paid_amount: values.paid_amount as string,
        discount_amount: values.discount_amount as string,
        status: values.status as FeeStatus,
        due_date: (values.due_date as string | null) ?? null,
        reminder_threshold_date: (values.reminder_threshold_date as string | null) ?? null,
        is_advance_payment: values.is_advance_payment as boolean,
        original_advance_month: (values.original_advance_month as number | null) ?? null,
        original_advance_year: (values.original_advance_year as number | null) ?? null,
      },
    };
  },

  keyOf(x: StudentFeeRow | StudentFee): string {
    // The `students` tab's own natural key is the student's
    // `registration_number` (per its ticket), read straight off the real
    // `Student` entity — never off the not-yet-existing `students` tab —
    // for an entity; a row already carries the key text from `fromRow`.
    const studentKey =
      x instanceof StudentFee ? (x.student?.registration_number ?? '') : x.student_key;
    const yearKey =
      x instanceof StudentFee
        ? x.academic_year
          ? academicYearsTab.keyOf(x.academic_year)
          : ''
        : x.academic_year_key;
    return `${studentKey}|${yearKey}|${x.month}|${x.year}`;
  },

  diffFields(row: StudentFeeRow, existing: StudentFee): string[] {
    const changed: string[] = [];
    if (row.month !== existing.month) changed.push('month');
    if (row.year !== existing.year) changed.push('year');
    if (String(row.total_amount) !== String(existing.total_amount)) changed.push('total_amount');
    if (String(row.paid_amount) !== String(existing.paid_amount)) changed.push('paid_amount');
    if (String(row.discount_amount) !== String(existing.discount_amount)) {
      changed.push('discount_amount');
    }
    if (row.status !== existing.status) changed.push('status');
    if (String(row.due_date) !== String(existing.due_date)) changed.push('due_date');
    if (String(row.reminder_threshold_date) !== String(existing.reminder_threshold_date)) {
      changed.push('reminder_threshold_date');
    }
    if (row.is_advance_payment !== existing.is_advance_payment) changed.push('is_advance_payment');
    if (row.original_advance_month !== existing.original_advance_month) {
      changed.push('original_advance_month');
    }
    if (row.original_advance_year !== existing.original_advance_year) {
      changed.push('original_advance_year');
    }
    return changed;
  },

  async upsert(
    row: StudentFeeRow,
    existing: StudentFee | null,
    _tenantId: string,
    m: EntityManager,
  ): Promise<StudentFee> {
    const fee = existing ?? new StudentFee();
    fee.student_id = row.student_id;
    fee.academic_year_id = row.academic_year_id;
    fee.month = row.month;
    fee.year = row.year;
    fee.total_amount = row.total_amount as unknown as number;
    fee.paid_amount = row.paid_amount as unknown as number;
    fee.discount_amount = row.discount_amount as unknown as number;
    fee.status = row.status;
    fee.due_date = row.due_date as unknown as Date | null;
    fee.reminder_threshold_date = row.reminder_threshold_date as unknown as Date | null;
    fee.is_advance_payment = row.is_advance_payment;
    fee.original_advance_month = row.original_advance_month;
    fee.original_advance_year = row.original_advance_year;

    return m.save(StudentFee, fee);
  },

  async remove(entity: StudentFee, m: EntityManager): Promise<void> {
    try {
      await m.delete(StudentFee, { id: entity.id });
    } catch (e) {
      if (e instanceof QueryFailedError && (e as { code?: string }).code === FK_VIOLATION) {
        throw new Error(
          `Cannot delete student fee ${entity.id}: it is referenced by a payment.`,
        );
      }
      throw e;
    }
  },
};
