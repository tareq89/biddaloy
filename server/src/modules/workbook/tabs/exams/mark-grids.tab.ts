import type { EntityManager } from 'typeorm';
import { MarkGrid } from '../../../exams/entities/mark-grid.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';
import { examsTab } from './exams.tab';
import { sectionsTab } from '../academics/sections.tab';

/**
 * The `mark_grids` tab: one section-subject's marks-entry grid state for
 * one exam — `MarkGrid` (19.2.1, D12). No soft delete on the entity, so
 * `remove` hard-deletes, same as `payment_allocations.tab.ts`.
 *
 * `submitted_by` has no FK relation on the entity (a plain nullable uuid),
 * so it is carried through as a raw `uuid` column rather than a `ref` —
 * there is no tab to resolve it against.
 */

export interface MarkGridRow {
  id: string;
  exam_id: string;
  exam_key: string;
  section_id: string;
  section_key: string;
  subject_id: string;
  subject_key: string;
  state: string;
  submitted_by: string | null;
  submitted_at: string | null;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  { key: 'exam', type: 'ref', ref: 'exams', required: true, label: { en: 'Exam', bn: 'পরীক্ষা' } },
  {
    key: 'section',
    type: 'ref',
    ref: 'sections',
    required: true,
    label: { en: 'Section', bn: 'শাখা' },
  },
  {
    key: 'subject',
    type: 'ref',
    ref: 'subjects',
    required: true,
    label: { en: 'Subject', bn: 'বিষয়' },
  },
  {
    key: 'state',
    type: 'enum',
    enumValues: ['DRAFT', 'SUBMITTED'],
    required: true,
    label: { en: 'State', bn: 'অবস্থা' },
  },
  { key: 'submitted_by', type: 'uuid', label: { en: 'Submitted by', bn: 'জমা দিয়েছেন' } },
  { key: 'submitted_at', type: 'datetime', label: { en: 'Submitted at', bn: 'জমার সময়' } },
];

const excluded: readonly string[] = [
  'exam_id', // exported instead as the `exam` ref column
  'section_id', // exported instead as the `section` ref column
  'subject_id', // exported instead as the `subject` ref column
];

export const markGridsTab: TabSpec<MarkGrid, MarkGridRow> = {
  name: 'mark_grids',
  entity: MarkGrid,
  excluded,
  dependsOn: ['exams', 'sections', 'subjects'],
  columns,
  naturalKey: ['exam', 'section', 'subject'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<MarkGrid[]> {
    return m.find(MarkGrid, {
      where: { tenant_id: tenantId },
      relations: [
        'exam',
        'exam.academic_year',
        'exam.class',
        'exam.class.academic_year',
        'section',
        'section.class',
        'section.class.academic_year',
        'subject',
      ],
    });
  },

  toRow(entity: MarkGrid, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      exam: ctx.keyOf('exams', entity.exam_id),
      section: ctx.keyOf('sections', entity.section_id),
      subject: ctx.keyOf('subjects', entity.subject_id),
      state: entity.state,
      submitted_by: entity.submitted_by,
      submitted_at: entity.submitted_at,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: MarkGridRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'mark_grids', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }
      values[column.key] = result.value;
    }

    if (errors.length > 0) return { errors };

    let examId: string | undefined;
    const examKey = values.exam as string;
    if (examKey) {
      examId = ctx.ref('exams', examKey);
      if (!examId) {
        errors.push({
          tab: 'mark_grids',
          row: rowNo,
          column: 'exam',
          message: `Column "exam": no exam "${examKey}" was found.`,
          severity: 'error',
          value: examKey,
        });
      }
    }

    let sectionId: string | undefined;
    const sectionKey = values.section as string;
    if (sectionKey) {
      sectionId = ctx.ref('sections', sectionKey);
      if (!sectionId) {
        errors.push({
          tab: 'mark_grids',
          row: rowNo,
          column: 'section',
          message: `Column "section": no section "${sectionKey}" was found.`,
          severity: 'error',
          value: sectionKey,
        });
      }
    }

    let subjectId: string | undefined;
    const subjectKey = values.subject as string;
    if (subjectKey) {
      subjectId = ctx.ref('subjects', subjectKey);
      if (!subjectId) {
        errors.push({
          tab: 'mark_grids',
          row: rowNo,
          column: 'subject',
          message: `Column "subject": no subject "${subjectKey}" was found.`,
          severity: 'error',
          value: subjectKey,
        });
      }
    }

    if (errors.length > 0) return { errors };

    return {
      row: {
        id: values.id as string,
        exam_id: examId as string,
        exam_key: examKey,
        section_id: sectionId as string,
        section_key: sectionKey,
        subject_id: subjectId as string,
        subject_key: subjectKey,
        state: values.state as string,
        submitted_by: (values.submitted_by as string | null) ?? null,
        submitted_at: (values.submitted_at as string | null) ?? null,
      },
    };
  },

  keyOf(x: MarkGridRow | MarkGrid): string {
    const examKey = x instanceof MarkGrid ? (x.exam ? examsTab.keyOf(x.exam) : '') : x.exam_key;
    const sectionKey =
      x instanceof MarkGrid ? (x.section ? sectionsTab.keyOf(x.section) : '') : x.section_key;
    const subjectKey = x instanceof MarkGrid ? (x.subject?.code ?? '') : x.subject_key;
    return `${examKey}|${sectionKey}|${subjectKey}`;
  },

  diffFields(row: MarkGridRow, existing: MarkGrid): string[] {
    const changed: string[] = [];
    if (row.exam_id !== existing.exam_id) changed.push('exam');
    if (row.section_id !== existing.section_id) changed.push('section');
    if (row.subject_id !== existing.subject_id) changed.push('subject');
    if (row.state !== existing.state) changed.push('state');
    if ((row.submitted_by ?? null) !== (existing.submitted_by ?? null)) {
      changed.push('submitted_by');
    }
    const rowSubmitted = row.submitted_at ?? null;
    const existingSubmitted = existing.submitted_at ? existing.submitted_at.toISOString() : null;
    if (rowSubmitted !== existingSubmitted) changed.push('submitted_at');
    return changed;
  },

  async upsert(
    row: MarkGridRow,
    existing: MarkGrid | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<MarkGrid> {
    const grid = existing ?? new MarkGrid();
    grid.tenant_id = tenantId;
    grid.exam_id = row.exam_id;
    grid.section_id = row.section_id;
    grid.subject_id = row.subject_id;
    grid.state = row.state as MarkGrid['state'];
    grid.submitted_by = row.submitted_by;
    grid.submitted_at = row.submitted_at ? new Date(row.submitted_at) : null;

    return m.save(MarkGrid, grid);
  },

  async remove(entity: MarkGrid, m: EntityManager): Promise<void> {
    await m.delete(MarkGrid, { id: entity.id });
  },
};
