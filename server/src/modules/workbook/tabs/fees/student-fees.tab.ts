import type { EntityManager } from 'typeorm';
import { QueryFailedError } from 'typeorm';
import { StudentFee } from '../../../fees/entities/student-fee.entity';
import { fromCell, formatDateOnly } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';
import { FeeStatus } from '@biddaloy/shared';
import { academicYearsTab } from '../academics/academic-years.tab';
import { feeStructuresTab } from './fee-structures.tab';

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
  fee_structure_id: string;
  fee_structure_key: string;
  month: number;
  year: number;
  occurrence: number;
  total_amount: string;
  paid_amount: string;
  discount_amount: string;
  standing_discount_amount: string;
  one_off_discount_amount: string;
  status: FeeStatus;
  due_date: string | null;
  reminder_threshold_date: string | null;
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
  {
    key: 'fee_structure',
    type: 'ref',
    ref: 'fee_structures',
    required: true,
    label: { en: 'Fee structure', bn: 'ফি কাঠামো' },
  },
  // `month`/`year` are still the import/export representation of the
  // billing period; the entity itself derives them from `period_start`
  // (16.1.3, D2), which `upsert` computes as that period's 1st.
  { key: 'month', type: 'int', required: true, label: { en: 'Month', bn: 'মাস' } },
  { key: 'year', type: 'int', required: true, label: { en: 'Year', bn: 'বছর' } },
  // Part of `StudentFee`'s real DB unique key (student, fee_structure,
  // period_start, occurrence) — distinguishes a re-billed occurrence of
  // the same (student, structure, period) bill, e.g. a late fee re-billed
  // after a DuplicateStrategy.CREATE_ANYWAY run. Excluding it from the
  // natural key would hash two genuinely different bills to the same key,
  // making `ValidationService` see them as duplicates.
  { key: 'occurrence', type: 'int', required: true, label: { en: 'Occurrence', bn: 'ক্রম' } },
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
  // `discount_amount` must equal the sum of these two (16.1.3's
  // `CHK_student_fees_discount_split`) — both round-trip through the tab
  // so a restore never zeroes them out from under a passing total.
  {
    key: 'standing_discount_amount',
    type: 'money',
    required: true,
    label: { en: 'Standing discount amount', bn: 'স্থায়ী ছাড়ের পরিমাণ' },
  },
  {
    key: 'one_off_discount_amount',
    type: 'money',
    required: true,
    label: { en: 'One-off discount amount', bn: 'একবারের ছাড়ের পরিমাণ' },
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
];

const excluded: readonly string[] = [
  'student_id', // exported instead as the `student` ref column
  'academic_year_id', // exported instead as the `academic_year` ref column
  'fee_structure_id', // exported instead as the `fee_structure` ref column
  // `month`/`year` columns round-trip the billing period; `period_start`
  // is the real column they're generated from (16.1.3, D2) — `upsert`
  // derives it from those two, so it needs no column of its own.
  'period_start',
  // `period_type` always defaults to `PeriodType.MONTH` for a workbook
  // restore (16.1.3 only defines MONTH/WEEK, and this tab only ever bills
  // by month) — not worth a column until a restore needs to pick WEEK.
  'period_type',
  // FK added in 16.1.4's migration, not this one (see the entity comment)
  // — 16.1.4 owns wiring generation-batch provenance into the workbook.
  'fee_generation_id',
  // Who approved this bill, and which bill (if any) this one is a late
  // fee against — neither has a workbook editing flow yet; a restore
  // leaves both null rather than fabricating provenance.
  'approved_by_user_id',
  'late_fee_for_student_fee_id',
];

/** Postgres error code for a foreign-key violation. */
const FK_VIOLATION = '23503';

export const studentFeesTab: TabSpec<StudentFee, StudentFeeRow> = {
  name: 'student_fees',
  entity: StudentFee,
  excluded,
  dependsOn: ['students', 'academic_years', 'fee_structures'],
  columns,
  naturalKey: ['student', 'academic_year', 'fee_structure', 'month', 'year', 'occurrence'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<StudentFee[]> {
    // `StudentFee` carries no `tenant_id` of its own — tenancy is filtered
    // through its `student` relation, which is loaded eagerly both to
    // filter by tenant and so
    // `keyOf` can read the student's own `registration_number` directly off
    // the real `Student` entity.
    return m.find(StudentFee, {
      where: { student: { tenant_id: tenantId } },
      // `fee_structure`'s own class/section/academic_year are loaded too —
      // `keyOf` delegates to `feeStructuresTab.keyOf`, which needs them
      // (same reasoning as `fee-structures.tab.ts`'s own `load()`).
      relations: [
        'student',
        'academic_year',
        'fee_structure',
        'fee_structure.class',
        'fee_structure.class.academic_year',
        'fee_structure.academic_year',
        'fee_structure.section',
      ],
    });
  },

  toRow(entity: StudentFee, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      student: ctx.keyOf('students', entity.student_id),
      academic_year: ctx.keyOf('academic_years', entity.academic_year_id),
      fee_structure: ctx.keyOf('fee_structures', entity.fee_structure_id),
      month: entity.month,
      year: entity.year,
      occurrence: entity.occurrence,
      total_amount: entity.total_amount,
      paid_amount: entity.paid_amount,
      discount_amount: entity.discount_amount,
      standing_discount_amount: entity.standing_discount_amount,
      one_off_discount_amount: entity.one_off_discount_amount,
      status: entity.status,
      due_date: entity.due_date,
      reminder_threshold_date: entity.reminder_threshold_date,
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

    // `period_start` is built from `month`/`year` in `upsert` via
    // `Date.UTC(row.year, row.month - 1, 1)`, which silently wraps an
    // out-of-range value instead of rejecting it (month 13 rolls into next
    // January; a 2-digit year like 26 becomes 1926). The DB's own CHECK
    // constraints (`month BETWEEN 1 AND 12`, `year > 0`) never see that
    // wrapped value to catch it, since it's already a valid month/year by
    // the time it reaches Postgres. Reject it here instead, at the cell.
    const month = values.month as number;
    if (month < 1 || month > 12) {
      errors.push({
        tab: 'student_fees',
        row: rowNo,
        column: 'month',
        message: `Column "month": "${month}" is not a valid month. Use a whole number from 1 to 12.`,
        severity: 'error',
        value: String(month),
      });
    }
    const year = values.year as number;
    if (year < 1900 || year > 2100) {
      errors.push({
        tab: 'student_fees',
        row: rowNo,
        column: 'year',
        message: `Column "year": "${year}" is not a valid year. Use a 4-digit year between 1900 and 2100.`,
        severity: 'error',
        value: String(year),
      });
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

    let feeStructureId: string | undefined;
    const feeStructureKey = values.fee_structure as string;
    if (feeStructureKey) {
      feeStructureId = ctx.ref('fee_structures', feeStructureKey);
      if (!feeStructureId) {
        errors.push({
          tab: 'student_fees',
          row: rowNo,
          column: 'fee_structure',
          message: `Column "fee_structure": no fee structure "${feeStructureKey}" was found.`,
          severity: 'error',
          value: feeStructureKey,
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
        fee_structure_id: feeStructureId as string,
        fee_structure_key: feeStructureKey,
        month: values.month as number,
        year: values.year as number,
        occurrence: values.occurrence as number,
        total_amount: values.total_amount as string,
        paid_amount: values.paid_amount as string,
        discount_amount: values.discount_amount as string,
        standing_discount_amount: values.standing_discount_amount as string,
        one_off_discount_amount: values.one_off_discount_amount as string,
        status: values.status as FeeStatus,
        due_date: (values.due_date as string | null) ?? null,
        reminder_threshold_date: (values.reminder_threshold_date as string | null) ?? null,
      },
    };
  },

  keyOf(x: StudentFeeRow | StudentFee): string {
    // The `students` tab's own natural key is the student's
    // `registration_number` (per its ticket), read straight off the real
    // `Student` entity for an entity; a row already carries the key text
    // from `fromRow`.
    const studentKey =
      x instanceof StudentFee ? (x.student?.registration_number.trim() ?? '') : x.student_key;
    const yearKey =
      x instanceof StudentFee
        ? x.academic_year
          ? academicYearsTab.keyOf(x.academic_year)
          : ''
        : x.academic_year_key;
    // Delegated to `feeStructuresTab.keyOf` — same composite key `toRow`
    // resolves through `ctx.keyOf('fee_structures', …)`, so a row's
    // `fee_structure_key` and a loaded entity's key always agree. A
    // mismatch here would make `deleteByAbsence` think every existing bill
    // is gone and delete it on every restore.
    const feeStructureKey =
      x instanceof StudentFee
        ? x.fee_structure
          ? feeStructuresTab.keyOf(x.fee_structure)
          : ''
        : x.fee_structure_key;
    return `${studentKey}|${yearKey}|${feeStructureKey}|${x.month}|${x.year}|${x.occurrence}`;
  },

  diffFields(row: StudentFeeRow, existing: StudentFee): string[] {
    const changed: string[] = [];
    if (row.fee_structure_id !== existing.fee_structure_id) changed.push('fee_structure');
    if (row.month !== existing.month) changed.push('month');
    if (row.year !== existing.year) changed.push('year');
    if (row.occurrence !== existing.occurrence) changed.push('occurrence');
    if (String(row.total_amount) !== String(existing.total_amount)) changed.push('total_amount');
    if (String(row.paid_amount) !== String(existing.paid_amount)) changed.push('paid_amount');
    if (String(row.discount_amount) !== String(existing.discount_amount)) {
      changed.push('discount_amount');
    }
    if (String(row.standing_discount_amount) !== String(existing.standing_discount_amount)) {
      changed.push('standing_discount_amount');
    }
    if (String(row.one_off_discount_amount) !== String(existing.one_off_discount_amount)) {
      changed.push('one_off_discount_amount');
    }
    if (row.status !== existing.status) changed.push('status');
    // Both are nullable `date` columns: `YYYY-MM-DD` on the row, a `Date`
    // on the entity. `String(Date)` never equals that, so an unguarded
    // compare reports both changed on every row of every restore.
    if (row.due_date !== dateOnlyOrNull(existing.due_date)) changed.push('due_date');
    if (row.reminder_threshold_date !== dateOnlyOrNull(existing.reminder_threshold_date)) {
      changed.push('reminder_threshold_date');
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
    fee.fee_structure_id = row.fee_structure_id;
    // `month`/`year` are stored generated columns (16.1.3, D2) — Postgres
    // rejects a direct write to them. `period_start` is the real column;
    // its 1st-of-the-month derives `month`/`year` back out on read.
    fee.period_start = new Date(Date.UTC(row.year, row.month - 1, 1));
    fee.occurrence = row.occurrence;
    fee.total_amount = row.total_amount as unknown as number;
    fee.paid_amount = row.paid_amount as unknown as number;
    fee.discount_amount = row.discount_amount as unknown as number;
    fee.standing_discount_amount = row.standing_discount_amount as unknown as number;
    fee.one_off_discount_amount = row.one_off_discount_amount as unknown as number;
    fee.status = row.status;
    fee.due_date = row.due_date as unknown as Date | null;
    fee.reminder_threshold_date = row.reminder_threshold_date as unknown as Date | null;

    return m.save(StudentFee, fee);
  },

  async remove(entity: StudentFee, m: EntityManager): Promise<void> {
    try {
      await m.delete(StudentFee, { id: entity.id });
    } catch (e) {
      if (e instanceof QueryFailedError && (e as { code?: string }).code === FK_VIOLATION) {
        throw new Error(`Cannot delete student fee ${entity.id}: it is referenced by a payment.`);
      }
      throw e;
    }
  },
};

/** `formatDateOnly` rejects null; these two columns are nullable. */
function dateOnlyOrNull(value: Date | null): string | null {
  return value === null || value === undefined ? null : formatDateOnly(value);
}
