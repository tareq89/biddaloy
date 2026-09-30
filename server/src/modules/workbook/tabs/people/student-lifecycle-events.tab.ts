import type { EntityManager } from 'typeorm';
import { StudentLifecycleEventType } from '@biddaloy/shared';
import { StudentLifecycleEvent } from '../../../students/entities/student-lifecycle-event.entity';
import { formatDateOnly, formatDateTime, fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';

/**
 * The `student_lifecycle_events` tab: the append-only log of withdrawals,
 * transfers, graduations and readmissions ([39.1.3]).
 *
 * Restore loads rows only. It must never call `StudentLifecycleService` or
 * `EnrollmentsService`: those replay side effects (status flips, new events),
 * and a restore reproduces the source school's history exactly as exported.
 * `upsert` is a plain `m.save`.
 *
 * `academic_year` is derivable from `enrollment` but is exported as its own ref
 * column so it round-trips without an extra lookup on import.
 */
export interface StudentLifecycleEventRow {
  id: string;
  student_id: string;
  enrollment_id: string;
  academic_year_id: string;
  event_type: StudentLifecycleEventType;
  occurred_on: string;
  reason: string;
  destination: string | null;
  remark: string | null;
  recorded_by_user_id: string | null;
  created_at: string | null;
  // Referenced tabs' key text, so `keyOf` matches for a row and an entity.
  student_key: string;
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
    key: 'enrollment',
    type: 'ref',
    ref: 'enrollments',
    required: true,
    label: { en: 'Enrollment', bn: 'ভর্তি' },
  },
  {
    key: 'academic_year',
    type: 'ref',
    ref: 'academic_years',
    required: true,
    label: { en: 'Academic year', bn: 'শিক্ষাবর্ষ' },
  },
  {
    key: 'event_type',
    type: 'enum',
    enumValues: Object.values(StudentLifecycleEventType),
    required: true,
    label: { en: 'Event type', bn: 'ঘটনার ধরন' },
  },
  {
    key: 'occurred_on',
    type: 'date',
    required: true,
    label: { en: 'Occurred on', bn: 'ঘটনার তারিখ' },
  },
  { key: 'reason', type: 'string', required: true, label: { en: 'Reason', bn: 'কারণ' } },
  { key: 'destination', type: 'string', label: { en: 'Destination', bn: 'গন্তব্য' } },
  { key: 'remark', type: 'string', label: { en: 'Remark', bn: 'মন্তব্য' } },
  {
    // Null only for rows backfilled from pre-existing enrollments (D23).
    key: 'recorded_by',
    type: 'ref',
    ref: 'users',
    label: { en: 'Recorded by', bn: 'নথিভুক্তকারী' },
  },
  {
    // Kept so a restore reproduces the log's timestamps exactly; empty = now.
    key: 'created_at',
    type: 'datetime',
    label: { en: 'Created at', bn: 'তৈরির সময়' },
  },
];

const excluded: readonly string[] = [
  'student_id', // exported instead as the `student` ref column
  'enrollment_id', // exported instead as the `enrollment` ref column
  'academic_year_id', // exported instead as the `academic_year` ref column
  'recorded_by_user_id', // exported instead as the `recorded_by` ref column
];

function unresolved(rowNo: number, column: string, key: string, what: string): RowError {
  return {
    tab: 'student_lifecycle_events',
    row: rowNo,
    column,
    message: `Column "${column}": no ${what} with the key "${key}" was found.`,
    severity: 'error',
    value: key,
  };
}

export const studentLifecycleEventsTab: TabSpec<StudentLifecycleEvent, StudentLifecycleEventRow> = {
  name: 'student_lifecycle_events',
  entity: StudentLifecycleEvent,
  excluded,
  dependsOn: ['students', 'enrollments', 'academic_years', 'users'],
  columns,
  naturalKey: ['student', 'event_type', 'occurred_on'],
  deleteByAbsence: true,
  // The table has no unique constraint on naturalKey and no other tab references events by
  // it. Legitimate data repeats it: leave, readmit, leave, readmit on one day gives two
  // WITHDRAWN rows for one student and date. Without this the validator hard-rejects that
  // tenant's own export on restore. See TabSpec.allowDuplicateKeys.
  allowDuplicateKeys: true,

  load(tenantId: string, m: EntityManager): Promise<StudentLifecycleEvent[]> {
    return m.find(StudentLifecycleEvent, {
      where: { tenant_id: tenantId },
      relations: ['student'],
    });
  },

  toRow(entity: StudentLifecycleEvent, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      student: ctx.keyOf('students', entity.student_id),
      enrollment: ctx.keyOf('enrollments', entity.enrollment_id),
      academic_year: ctx.keyOf('academic_years', entity.academic_year_id),
      event_type: entity.event_type,
      occurred_on: entity.occurred_on,
      reason: entity.reason,
      destination: entity.destination,
      remark: entity.remark,
      recorded_by: entity.recorded_by_user_id
        ? ctx.keyOf('users', entity.recorded_by_user_id)
        : null,
      created_at: entity.created_at,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: StudentLifecycleEventRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const result = fromCell(column, cells[column.key] ?? '', 'student_lifecycle_events', rowNo);
      if ('error' in result) errors.push(result.error);
      else values[column.key] = result.value;
    }
    if (errors.length > 0) return { errors };

    const studentKey = values.student as string;
    const studentId = ctx.ref('students', studentKey);
    if (!studentId) errors.push(unresolved(rowNo, 'student', studentKey, 'student'));

    const enrollmentKey = values.enrollment as string;
    const enrollmentId = ctx.ref('enrollments', enrollmentKey);
    if (!enrollmentId) errors.push(unresolved(rowNo, 'enrollment', enrollmentKey, 'enrollment'));

    const yearKey = values.academic_year as string;
    const yearId = ctx.ref('academic_years', yearKey);
    if (!yearId) errors.push(unresolved(rowNo, 'academic_year', yearKey, 'academic year'));

    const recorderKey = (values.recorded_by as string | null) ?? '';
    let recorderId: string | null = null;
    if (recorderKey) {
      recorderId = ctx.ref('users', recorderKey) ?? null;
      if (!recorderId) errors.push(unresolved(rowNo, 'recorded_by', recorderKey, 'user'));
    }

    if (errors.length > 0) return { errors };

    return {
      row: {
        id: values.id as string,
        student_id: studentId as string,
        enrollment_id: enrollmentId as string,
        academic_year_id: yearId as string,
        event_type: values.event_type as StudentLifecycleEventType,
        occurred_on: values.occurred_on as string,
        reason: values.reason as string,
        destination: (values.destination as string | null) ?? null,
        remark: (values.remark as string | null) ?? null,
        recorded_by_user_id: recorderId,
        created_at: (values.created_at as string | null) ?? null,
        student_key: studentKey,
      },
    };
  },

  keyOf(x: StudentLifecycleEventRow | StudentLifecycleEvent): string {
    const studentKey =
      x instanceof StudentLifecycleEvent
        ? (x.student?.registration_number?.trim() ?? '')
        : x.student_key;
    return `${studentKey}|${x.event_type}|${formatDateOnly(x.occurred_on)}`;
  },

  diffFields(row: StudentLifecycleEventRow, existing: StudentLifecycleEvent): string[] {
    const changed: string[] = [];
    if (row.student_id !== existing.student_id) changed.push('student');
    if (row.enrollment_id !== existing.enrollment_id) changed.push('enrollment');
    if (row.academic_year_id !== existing.academic_year_id) changed.push('academic_year');
    if (row.event_type !== existing.event_type) changed.push('event_type');
    if (row.occurred_on !== formatDateOnly(existing.occurred_on)) changed.push('occurred_on');
    if (row.reason !== existing.reason) changed.push('reason');
    if (row.destination !== existing.destination) changed.push('destination');
    if (row.remark !== existing.remark) changed.push('remark');
    if (row.recorded_by_user_id !== existing.recorded_by_user_id) changed.push('recorded_by');
    if (row.created_at && row.created_at !== formatDateTime(existing.created_at)) {
      changed.push('created_at');
    }
    return changed;
  },

  async upsert(
    row: StudentLifecycleEventRow,
    existing: StudentLifecycleEvent | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<StudentLifecycleEvent> {
    const event = existing ?? new StudentLifecycleEvent();
    event.tenant_id = tenantId;
    event.student_id = row.student_id;
    event.enrollment_id = row.enrollment_id;
    event.academic_year_id = row.academic_year_id;
    event.event_type = row.event_type;
    event.occurred_on = row.occurred_on;
    event.reason = row.reason;
    event.destination = row.destination;
    event.remark = row.remark;
    event.recorded_by_user_id = row.recorded_by_user_id;
    if (row.created_at) event.created_at = new Date(row.created_at);
    // Rows only: no StudentLifecycleService / EnrollmentsService — restore never replays side effects.
    return m.save(StudentLifecycleEvent, event);
  },

  async remove(entity: StudentLifecycleEvent, m: EntityManager): Promise<void> {
    // No `deleted_at` on this entity: hard delete.
    await m.remove(StudentLifecycleEvent, entity);
  },
};
