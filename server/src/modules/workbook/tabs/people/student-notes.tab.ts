import { In, type EntityManager } from 'typeorm';
import { StudentNote } from '../../../students/entities/student-note.entity';
import { User } from '../../../users/entities/user.entity';
import { formatDateTime, fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';

/**
 * The `student_notes` tab: staff notes on a student ([39.1.3], D29).
 *
 * Restore loads rows only (plain `m.save`); no lifecycle side effects.
 *
 * `StudentNote` has no relation to `User` (only `author_user_id`), so `keyOf`
 * on an entity cannot reach the author's email by itself. `load` therefore
 * stamps the author's key (the `users` tab's own key: email, else phone) onto
 * each loaded note as `author_key`, and `keyOf` reads it back.
 */
export interface StudentNoteRow {
  id: string;
  student_id: string;
  author_user_id: string;
  body: string;
  created_at: string;
  student_key: string;
  author_key: string;
}

type LoadedNote = StudentNote & { author_key?: string };

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
    key: 'author',
    type: 'ref',
    ref: 'users',
    required: true,
    label: { en: 'Author', bn: 'লেখক' },
  },
  { key: 'body', type: 'string', required: true, label: { en: 'Note', bn: 'নোট' } },
  {
    // Part of the natural key, so required and restored verbatim.
    key: 'created_at',
    type: 'datetime',
    required: true,
    label: { en: 'Created at', bn: 'তৈরির সময়' },
  },
];

const excluded: readonly string[] = [
  'student_id', // exported instead as the `student` ref column
  'author_user_id', // exported instead as the `author` ref column
];

function unresolved(rowNo: number, column: string, key: string, what: string): RowError {
  return {
    tab: 'student_notes',
    row: rowNo,
    column,
    message: `Column "${column}": no ${what} with the key "${key}" was found.`,
    severity: 'error',
    value: key,
  };
}

export const studentNotesTab: TabSpec<StudentNote, StudentNoteRow> = {
  name: 'student_notes',
  entity: StudentNote,
  excluded,
  dependsOn: ['students', 'users'],
  columns,
  naturalKey: ['student', 'created_at', 'author'],
  deleteByAbsence: true,

  async load(tenantId: string, m: EntityManager): Promise<StudentNote[]> {
    const notes = (await m.find(StudentNote, {
      where: { tenant_id: tenantId },
      relations: ['student'],
    })) as LoadedNote[];
    const authorIds = [...new Set(notes.map((n) => n.author_user_id))];
    const users = authorIds.length ? await m.find(User, { where: { id: In(authorIds) } }) : [];
    const keyById = new Map(users.map((u) => [u.id, u.email?.trim() || u.phone?.trim() || '']));
    for (const n of notes) n.author_key = keyById.get(n.author_user_id) ?? '';
    return notes;
  },

  toRow(entity: StudentNote, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      student: ctx.keyOf('students', entity.student_id),
      author: ctx.keyOf('users', entity.author_user_id),
      body: entity.body,
      created_at: entity.created_at,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: StudentNoteRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const result = fromCell(column, cells[column.key] ?? '', 'student_notes', rowNo);
      if ('error' in result) errors.push(result.error);
      else values[column.key] = result.value;
    }
    if (errors.length > 0) return { errors };

    const studentKey = values.student as string;
    const studentId = ctx.ref('students', studentKey);
    if (!studentId) errors.push(unresolved(rowNo, 'student', studentKey, 'student'));

    const authorKey = values.author as string;
    const authorId = ctx.ref('users', authorKey);
    if (!authorId) errors.push(unresolved(rowNo, 'author', authorKey, 'user'));

    if (errors.length > 0) return { errors };

    return {
      row: {
        id: values.id as string,
        student_id: studentId as string,
        author_user_id: authorId as string,
        body: values.body as string,
        created_at: values.created_at as string,
        student_key: studentKey,
        author_key: authorKey,
      },
    };
  },

  keyOf(x: StudentNoteRow | StudentNote): string {
    const studentKey =
      x instanceof StudentNote ? (x.student?.registration_number?.trim() ?? '') : x.student_key;
    const authorKey =
      x instanceof StudentNote ? ((x as LoadedNote).author_key ?? '') : x.author_key;
    return `${studentKey}|${formatDateTime(x.created_at)}|${authorKey}`;
  },

  diffFields(row: StudentNoteRow, existing: StudentNote): string[] {
    const changed: string[] = [];
    if (row.student_id !== existing.student_id) changed.push('student');
    if (row.author_user_id !== existing.author_user_id) changed.push('author');
    if (row.body !== existing.body) changed.push('body');
    if (row.created_at !== formatDateTime(existing.created_at)) changed.push('created_at');
    return changed;
  },

  async upsert(
    row: StudentNoteRow,
    existing: StudentNote | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<StudentNote> {
    const note = existing ?? new StudentNote();
    note.tenant_id = tenantId;
    note.student_id = row.student_id;
    note.author_user_id = row.author_user_id;
    note.body = row.body;
    note.created_at = new Date(row.created_at);
    return m.save(StudentNote, note);
  },

  async remove(entity: StudentNote, m: EntityManager): Promise<void> {
    await m.softRemove(StudentNote, entity);
  },
};
