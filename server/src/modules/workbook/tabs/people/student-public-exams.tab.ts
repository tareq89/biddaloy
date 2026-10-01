import type { EntityManager } from 'typeorm';
import { PublicExamType } from '@biddaloy/shared';
import { StudentPublicExam } from '../../../students/entities/student-public-exam.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';

/**
 * The `student_public_exams` tab: board/public exam results per student
 * ([39.1.3], D21). Restore loads rows only (plain `m.save`).
 *
 * `gpa` is `numeric(3,2)`, so it travels as a `money` cell (exactly two
 * decimals, string-only, no float rounding).
 */
export interface StudentPublicExamRow {
  id: string;
  student_id: string;
  exam_type: PublicExamType;
  board: string;
  roll_no: string;
  registration_no: string;
  gpa: string | null;
  passing_year: number;
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
    key: 'exam_type',
    type: 'enum',
    enumValues: Object.values(PublicExamType),
    required: true,
    label: { en: 'Exam type', bn: 'পরীক্ষার ধরন' },
  },
  { key: 'board', type: 'string', required: true, label: { en: 'Board', bn: 'বোর্ড' } },
  { key: 'roll_no', type: 'string', required: true, label: { en: 'Roll no.', bn: 'রোল নম্বর' } },
  {
    key: 'registration_no',
    type: 'string',
    required: true,
    label: { en: 'Registration no.', bn: 'রেজিস্ট্রেশন নম্বর' },
  },
  { key: 'gpa', type: 'money', label: { en: 'GPA', bn: 'জিপিএ' } },
  {
    key: 'passing_year',
    type: 'int',
    required: true,
    label: { en: 'Passing year', bn: 'পাসের বছর' },
  },
];

const excluded: readonly string[] = [
  'student_id', // exported instead as the `student` ref column
];

export const studentPublicExamsTab: TabSpec<StudentPublicExam, StudentPublicExamRow> = {
  name: 'student_public_exams',
  entity: StudentPublicExam,
  excluded,
  dependsOn: ['students'],
  columns,
  naturalKey: ['student', 'exam_type', 'passing_year'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<StudentPublicExam[]> {
    return m.find(StudentPublicExam, {
      where: { tenant_id: tenantId },
      relations: ['student'],
    });
  },

  toRow(entity: StudentPublicExam, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      student: ctx.keyOf('students', entity.student_id),
      exam_type: entity.exam_type,
      board: entity.board,
      roll_no: entity.roll_no,
      registration_no: entity.registration_no,
      gpa: entity.gpa,
      passing_year: entity.passing_year,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: StudentPublicExamRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const result = fromCell(column, cells[column.key] ?? '', 'student_public_exams', rowNo);
      if ('error' in result) errors.push(result.error);
      else values[column.key] = result.value;
    }
    if (errors.length > 0) return { errors };

    // `gpa` is numeric(3,2) but the `money` cell accepts any amount; without this a
    // value like 12.50 passes validation and aborts the whole restore in `save`.
    const gpa = values.gpa as string | null;
    if (gpa != null && !(Number(gpa) >= 0 && Number(gpa) <= 5)) {
      return {
        errors: [
          {
            tab: 'student_public_exams',
            row: rowNo,
            column: 'gpa',
            message: 'Column "GPA": must be between 0.00 and 5.00.',
            severity: 'error',
            value: gpa,
          },
        ],
      };
    }

    const studentKey = values.student as string;
    const studentId = ctx.ref('students', studentKey);
    if (!studentId) {
      return {
        errors: [
          {
            tab: 'student_public_exams',
            row: rowNo,
            column: 'student',
            message: `Column "student": no student with the key "${studentKey}" was found.`,
            severity: 'error',
            value: studentKey,
          },
        ],
      };
    }

    return {
      row: {
        id: values.id as string,
        student_id: studentId,
        exam_type: values.exam_type as PublicExamType,
        board: values.board as string,
        roll_no: values.roll_no as string,
        registration_no: values.registration_no as string,
        gpa: (values.gpa as string | null) ?? null,
        passing_year: values.passing_year as number,
        student_key: studentKey,
      },
    };
  },

  keyOf(x: StudentPublicExamRow | StudentPublicExam): string {
    const studentKey =
      x instanceof StudentPublicExam
        ? (x.student?.registration_number?.trim() ?? '')
        : x.student_key;
    return `${studentKey}|${x.exam_type}|${x.passing_year}`;
  },

  diffFields(row: StudentPublicExamRow, existing: StudentPublicExam): string[] {
    const changed: string[] = [];
    if (row.student_id !== existing.student_id) changed.push('student');
    if (row.exam_type !== existing.exam_type) changed.push('exam_type');
    if (row.board !== existing.board) changed.push('board');
    if (row.roll_no !== existing.roll_no) changed.push('roll_no');
    if (row.registration_no !== existing.registration_no) changed.push('registration_no');
    // Postgres returns numeric(3,2) as "3.50"; the money cell is also 2dp.
    if (row.gpa !== existing.gpa) changed.push('gpa');
    if (row.passing_year !== existing.passing_year) changed.push('passing_year');
    return changed;
  },

  async upsert(
    row: StudentPublicExamRow,
    existing: StudentPublicExam | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<StudentPublicExam> {
    const exam = existing ?? new StudentPublicExam();
    exam.tenant_id = tenantId;
    exam.student_id = row.student_id;
    exam.exam_type = row.exam_type;
    exam.board = row.board;
    exam.roll_no = row.roll_no;
    exam.registration_no = row.registration_no;
    exam.gpa = row.gpa;
    exam.passing_year = row.passing_year;
    return m.save(StudentPublicExam, exam);
  },

  async remove(entity: StudentPublicExam, m: EntityManager): Promise<void> {
    await m.softRemove(StudentPublicExam, entity);
  },
};
