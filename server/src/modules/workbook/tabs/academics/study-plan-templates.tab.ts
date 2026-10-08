import type { EntityManager } from 'typeorm';
import type { StudyPlanTemplateLesson } from '@biddaloy/shared';
import { StudyPlanTemplate } from '../../../study-plans/entities/study-plan-template.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';
import { lessonsCellError } from './study-plans.tab';

/** The `study_plan_templates` tab (Epic 66.0, [66.1.03]). No refs; the name is the key. */
export interface StudyPlanTemplateRow {
  id: string;
  name: string;
  class_grade: number;
  subject_code: string;
  lessons: StudyPlanTemplateLesson[];
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  { key: 'name', type: 'string', required: true, label: { en: 'Name', bn: 'নাম' } },
  {
    key: 'class_grade',
    type: 'int',
    required: true,
    label: { en: 'Class grade', bn: 'শ্রেণীর স্তর' },
  },
  {
    key: 'subject_code',
    type: 'string',
    required: true,
    label: { en: 'Subject code', bn: 'বিষয় কোড' },
  },
  { key: 'lessons', type: 'json', required: true, label: { en: 'Lessons', bn: 'পাঠসমূহ' } },
];

export const studyPlanTemplatesTab: TabSpec<StudyPlanTemplate, StudyPlanTemplateRow> = {
  name: 'study_plan_templates',
  entity: StudyPlanTemplate,
  excluded: [],
  dependsOn: [],
  columns,
  naturalKey: ['name'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<StudyPlanTemplate[]> {
    // A plain `find` already skips soft-deleted templates.
    return m.find(StudyPlanTemplate, { where: { tenant_id: tenantId } });
  },

  toRow(entity: StudyPlanTemplate, _ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      name: entity.name,
      class_grade: entity.class_grade,
      subject_code: entity.subject_code,
      lessons: entity.lessons ?? [],
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    _ctx: ImportContext,
  ): { row: StudyPlanTemplateRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};
    for (const column of columns) {
      const result = fromCell(column, cells[column.key] ?? '', 'study_plan_templates', rowNo);
      if ('error' in result) errors.push(result.error);
      else values[column.key] = result.value;
    }
    if (errors.length > 0) return { errors };

    const lessonsError = lessonsCellError(values.lessons);
    if (lessonsError) {
      return {
        errors: [
          {
            tab: 'study_plan_templates',
            row: rowNo,
            column: 'lessons',
            message: `Column "lessons": ${lessonsError}`,
            severity: 'error',
            value: cells.lessons,
          },
        ],
      };
    }

    return {
      row: {
        id: values.id as string,
        name: values.name as string,
        class_grade: values.class_grade as number,
        subject_code: values.subject_code as string,
        lessons: values.lessons as StudyPlanTemplateLesson[],
      },
    };
  },

  keyOf(x: StudyPlanTemplateRow | StudyPlanTemplate): string {
    return x.name;
  },

  diffFields(row: StudyPlanTemplateRow, existing: StudyPlanTemplate): string[] {
    const changed: string[] = [];
    if (row.class_grade !== existing.class_grade) changed.push('class_grade');
    if (row.subject_code !== existing.subject_code) changed.push('subject_code');
    if (JSON.stringify(row.lessons) !== JSON.stringify(existing.lessons)) changed.push('lessons');
    return changed;
  },

  async upsert(
    row: StudyPlanTemplateRow,
    existing: StudyPlanTemplate | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<StudyPlanTemplate> {
    const template = existing ?? new StudyPlanTemplate();
    template.tenant_id = tenantId;
    template.name = row.name;
    template.class_grade = row.class_grade;
    template.subject_code = row.subject_code;
    template.lessons = row.lessons;
    return m.save(StudyPlanTemplate, template);
  },

  async remove(entity: StudyPlanTemplate, m: EntityManager): Promise<void> {
    await m.remove(StudyPlanTemplate, entity);
  },
};
