import type { EntityManager } from 'typeorm';
import { ProgramEnrollmentStatus } from '@biddaloy/shared';
import { ProgramEnrollment } from '../../../programs/entities/program-enrollment.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';
import { programsTab } from './programs.tab';
import { studentsTab } from '../people/students.tab';

/**
 * The `program_enrollments` tab (Epic 34.0, [34.1.4]): a student's
 * enrollment in a `Program`. Natural key is `program|student|started_on` —
 * a student can re-enroll in the same program after a prior enrollment
 * ended, so `started_on` distinguishes the rows (only one ACTIVE at a time
 * is enforced by the DB's partial unique index, not by this key).
 */
export interface ProgramEnrollmentRow {
  id: string;
  program_id: string;
  student_id: string;
  started_on: string;
  ended_on: string | null;
  status: ProgramEnrollmentStatus;
  program_key: string;
  student_key: string;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  {
    key: 'program',
    type: 'ref',
    ref: 'programs',
    required: true,
    label: { en: 'Program', bn: 'প্রোগ্রাম' },
  },
  {
    key: 'student',
    type: 'ref',
    ref: 'students',
    required: true,
    label: { en: 'Student', bn: 'শিক্ষার্থী' },
  },
  {
    key: 'started_on',
    type: 'date',
    required: true,
    label: { en: 'Started on', bn: 'শুরুর তারিখ' },
  },
  { key: 'ended_on', type: 'date', label: { en: 'Ended on', bn: 'শেষের তারিখ' } },
  {
    key: 'status',
    type: 'enum',
    required: true,
    enumValues: Object.values(ProgramEnrollmentStatus),
    label: { en: 'Status', bn: 'অবস্থা' },
  },
];

const excluded: readonly string[] = [
  'program_id', // exported instead as the `program` ref column, keyed by the program's name
  'student_id', // exported instead as the `student` ref column, keyed by registration_number
];

export const programEnrollmentsTab: TabSpec<ProgramEnrollment, ProgramEnrollmentRow> = {
  name: 'program_enrollments',
  entity: ProgramEnrollment,
  excluded,
  dependsOn: ['programs', 'students'],
  columns,
  naturalKey: ['program', 'student', 'started_on'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<ProgramEnrollment[]> {
    return m.find(ProgramEnrollment, {
      where: { tenant_id: tenantId },
      relations: ['program', 'student'],
    });
  },

  toRow(entity: ProgramEnrollment, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      program: ctx.keyOf('programs', entity.program_id),
      student: ctx.keyOf('students', entity.student_id),
      started_on: entity.started_on,
      ended_on: entity.ended_on,
      status: entity.status,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: ProgramEnrollmentRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'program_enrollments', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }
      values[column.key] = result.value;
    }

    if (errors.length > 0) return { errors };

    const programKey = values.program as string;
    const programId = ctx.ref('programs', programKey);
    if (!programId) {
      errors.push({
        tab: 'program_enrollments',
        row: rowNo,
        column: 'program',
        message: `Column "program": no program named "${programKey}" was found.`,
        severity: 'error',
        value: programKey,
      });
    }

    const studentKey = values.student as string;
    const studentId = ctx.ref('students', studentKey);
    if (!studentId) {
      errors.push({
        tab: 'program_enrollments',
        row: rowNo,
        column: 'student',
        message: `Column "student": no student with registration number "${studentKey}" was found.`,
        severity: 'error',
        value: studentKey,
      });
    }

    if (errors.length > 0) return { errors };

    return {
      row: {
        id: values.id as string,
        program_id: programId as string,
        student_id: studentId as string,
        started_on: values.started_on as string,
        ended_on: (values.ended_on as string | null) ?? null,
        status: values.status as ProgramEnrollmentStatus,
        program_key: programKey,
        student_key: studentKey,
      },
    };
  },

  keyOf(x: ProgramEnrollmentRow | ProgramEnrollment): string {
    const programKey =
      x instanceof ProgramEnrollment
        ? x.program
          ? programsTab.keyOf(x.program)
          : ''
        : x.program_key;
    const studentKey =
      x instanceof ProgramEnrollment
        ? x.student
          ? studentsTab.keyOf(x.student)
          : ''
        : x.student_key;
    return `${programKey}|${studentKey}|${x.started_on}`;
  },

  diffFields(row: ProgramEnrollmentRow, existing: ProgramEnrollment): string[] {
    const changed: string[] = [];
    if (row.ended_on !== existing.ended_on) changed.push('ended_on');
    if (row.status !== existing.status) changed.push('status');
    return changed;
  },

  async upsert(
    row: ProgramEnrollmentRow,
    existing: ProgramEnrollment | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<ProgramEnrollment> {
    const enrollment = existing ?? new ProgramEnrollment();
    enrollment.tenant_id = tenantId;
    enrollment.program_id = row.program_id;
    enrollment.student_id = row.student_id;
    enrollment.started_on = row.started_on;
    enrollment.ended_on = row.ended_on;
    enrollment.status = row.status;
    return m.save(ProgramEnrollment, enrollment);
  },

  async remove(entity: ProgramEnrollment, m: EntityManager): Promise<void> {
    await m.remove(ProgramEnrollment, entity);
  },
};
