import type { EntityManager } from 'typeorm';
import { ExamTemplateComponent } from '../../../exams/entities/exam-template-component.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';

/**
 * The `exam_template_components` tab: one component line of an exam template
 * ([35.1.3]). The `template` ref column carries the template's `name`. The
 * entity has no soft delete, so removal is a hard delete.
 */

export interface ExamTemplateComponentRow {
  id: string;
  template_id: string;
  template_key: string;
  class_grade: number;
  subject_code: string;
  sequence: number;
  name: string;
  kind: string;
  full_marks: string;
  pass_marks: string;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  {
    key: 'template',
    type: 'ref',
    ref: 'exam_templates',
    required: true,
    label: { en: 'Template', bn: 'টেমপ্লেট' },
  },
  {
    key: 'class_grade',
    type: 'int',
    required: true,
    label: { en: 'Class grade', bn: 'শ্রেণীর মান' },
  },
  {
    key: 'subject_code',
    type: 'string',
    required: true,
    label: { en: 'Subject code', bn: 'বিষয় কোড' },
  },
  { key: 'sequence', type: 'int', required: true, label: { en: 'Sequence', bn: 'ক্রম' } },
  { key: 'name', type: 'string', required: true, label: { en: 'Name', bn: 'নাম' } },
  {
    key: 'kind',
    type: 'enum',
    enumValues: [
      'WRITTEN',
      'MCQ',
      'VIVA',
      'LAB',
      'PRACTICAL',
      'MONTHLY_TEST',
      'ATTENDANCE',
      'OTHER',
    ],
    required: true,
    label: { en: 'Kind', bn: 'ধরন' },
  },
  {
    key: 'full_marks',
    type: 'money',
    required: true,
    label: { en: 'Full marks', bn: 'পূর্ণমান' },
  },
  {
    key: 'pass_marks',
    type: 'money',
    required: true,
    label: { en: 'Pass marks', bn: 'পাস নম্বর' },
  },
];

const excluded: readonly string[] = [
  'tenant_id', // always the destination tenant
  'template_id', // exported instead as the `template` ref column
  'created_at', // system timestamps
  'updated_at',
];

const MAX_LENGTHS: Record<string, number> = { name: 200, subject_code: 20 };

export const examTemplateComponentsTab: TabSpec<ExamTemplateComponent, ExamTemplateComponentRow> = {
  name: 'exam_template_components',
  entity: ExamTemplateComponent,
  excluded,
  dependsOn: ['exam_templates'],
  columns,
  naturalKey: ['template', 'class_grade', 'subject_code', 'name'],
  deleteByAbsence: true,

  async load(tenantId: string, m: EntityManager): Promise<ExamTemplateComponent[]> {
    const components = await m.find(ExamTemplateComponent, {
      where: { tenant_id: tenantId },
      relations: ['template'],
    });
    // A soft-deleted template's lines stay in the table (no soft delete of
    // their own) but its join comes back null. Skip them: exporting one would
    // make `toRow`'s `ctx.keyOf('exam_templates', ...)` throw and fail the
    // whole backup.
    return components.filter((c) => c.template);
  },

  toRow(entity: ExamTemplateComponent, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      template: ctx.keyOf('exam_templates', entity.template_id),
      class_grade: entity.class_grade,
      subject_code: entity.subject_code,
      sequence: entity.sequence,
      name: entity.name,
      kind: entity.kind,
      full_marks: entity.full_marks,
      pass_marks: entity.pass_marks,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: ExamTemplateComponentRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'exam_template_components', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }
      const limit = MAX_LENGTHS[column.key];
      if (limit !== undefined && typeof result.value === 'string' && result.value.length > limit) {
        errors.push({
          tab: 'exam_template_components',
          row: rowNo,
          column: column.key,
          message: `Column "${column.key}": is longer than the ${limit} characters allowed.`,
          severity: 'error',
          value: raw,
        });
        continue;
      }
      values[column.key] = result.value;
    }

    if (errors.length > 0) return { errors };

    const templateKey = values.template as string;
    const templateId = ctx.ref('exam_templates', templateKey);
    if (!templateId) {
      return {
        errors: [
          {
            tab: 'exam_template_components',
            row: rowNo,
            column: 'template',
            message: `Column "template": no exam template named "${templateKey}" was found.`,
            severity: 'error',
            value: templateKey,
          },
        ],
      };
    }

    return {
      row: {
        id: values.id as string,
        template_id: templateId,
        template_key: templateKey,
        class_grade: values.class_grade as number,
        subject_code: values.subject_code as string,
        sequence: values.sequence as number,
        name: values.name as string,
        kind: values.kind as string,
        full_marks: values.full_marks as string,
        pass_marks: values.pass_marks as string,
      },
    };
  },

  keyOf(x: ExamTemplateComponentRow | ExamTemplateComponent): string {
    const templateKey =
      x instanceof ExamTemplateComponent ? (x.template?.name ?? '') : x.template_key;
    return `${templateKey}|${x.class_grade}|${x.subject_code}|${x.name}`;
  },

  diffFields(row: ExamTemplateComponentRow, existing: ExamTemplateComponent): string[] {
    const changed: string[] = [];
    if (row.template_id !== existing.template_id) changed.push('template');
    if (row.class_grade !== existing.class_grade) changed.push('class_grade');
    if (row.subject_code !== existing.subject_code) changed.push('subject_code');
    if (row.sequence !== existing.sequence) changed.push('sequence');
    if (row.name !== existing.name) changed.push('name');
    if (row.kind !== existing.kind) changed.push('kind');
    if (String(row.full_marks) !== String(existing.full_marks)) changed.push('full_marks');
    if (String(row.pass_marks) !== String(existing.pass_marks)) changed.push('pass_marks');
    return changed;
  },

  async upsert(
    row: ExamTemplateComponentRow,
    existing: ExamTemplateComponent | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<ExamTemplateComponent> {
    const component = existing ?? new ExamTemplateComponent();
    component.tenant_id = tenantId;
    component.template_id = row.template_id;
    component.class_grade = row.class_grade;
    component.subject_code = row.subject_code;
    component.sequence = row.sequence;
    component.name = row.name;
    component.kind = row.kind as ExamTemplateComponent['kind'];
    component.full_marks = row.full_marks;
    component.pass_marks = row.pass_marks;
    return m.save(ExamTemplateComponent, component);
  },

  async remove(entity: ExamTemplateComponent, m: EntityManager): Promise<void> {
    await m.delete(ExamTemplateComponent, { id: entity.id });
  },
};
