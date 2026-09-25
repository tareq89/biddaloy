import type { EntityManager } from 'typeorm';
import { AdmissionIntake } from '../../../admission/entities/admission-intake.entity';
import { fromCell, formatDateOnly } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';
import { sectionsTab } from '../academics';

/**
 * The `admission_intakes` tab (Epic 27.0): an admission window opened for one
 * class section.
 *
 * `class_section` is a `ref` column into the `sections` tab, so this depends
 * on `sections` and must sit after it in `EXPECTED_TABS`.
 */
export interface AdmissionIntakeRow {
  id: string;
  class_section_id: string;
  class_section_key: string;
  title: string;
  seat_count: number;
  open_date: string;
  close_date: string;
  required_document_types: string[];
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  {
    key: 'class_section',
    type: 'ref',
    ref: 'sections',
    required: true,
    label: { en: 'Class section', bn: 'শ্রেণী শাখা' },
  },
  { key: 'title', type: 'string', required: true, label: { en: 'Title', bn: 'শিরোনাম' } },
  {
    key: 'seat_count',
    type: 'int',
    required: true,
    label: { en: 'Seat count', bn: 'আসন সংখ্যা' },
  },
  { key: 'open_date', type: 'date', required: true, label: { en: 'Open date', bn: 'খোলার তারিখ' } },
  {
    key: 'close_date',
    type: 'date',
    required: true,
    label: { en: 'Close date', bn: 'বন্ধের তারিখ' },
  },
  {
    key: 'required_document_types',
    type: 'json',
    label: { en: 'Required document types', bn: 'প্রয়োজনীয় নথির ধরন' },
  },
];

const excluded: readonly string[] = [
  'class_section_id', // exported instead as the `class_section` ref column
];

const MAX_LENGTHS: Record<string, number> = {
  title: 200,
};

export const admissionIntakesTab: TabSpec<AdmissionIntake, AdmissionIntakeRow> = {
  name: 'admission_intakes',
  entity: AdmissionIntake,
  excluded,
  dependsOn: ['sections'],
  columns,
  naturalKey: ['class_section', 'title'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<AdmissionIntake[]> {
    return m.find(AdmissionIntake, {
      where: { tenant_id: tenantId },
      relations: ['class_section', 'class_section.class', 'class_section.class.academic_year'],
    });
  },

  toRow(entity: AdmissionIntake, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      class_section: ctx.keyOf('sections', entity.class_section_id),
      title: entity.title,
      seat_count: entity.seat_count,
      open_date: entity.open_date,
      close_date: entity.close_date,
      required_document_types: entity.required_document_types ?? [],
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: AdmissionIntakeRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'admission_intakes', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }

      const limit = MAX_LENGTHS[column.key];
      if (limit !== undefined && typeof result.value === 'string' && result.value.length > limit) {
        errors.push({
          tab: 'admission_intakes',
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

    const classSectionKey = values.class_section as string;
    const classSectionId = ctx.ref('sections', classSectionKey);
    if (!classSectionId) {
      errors.push({
        tab: 'admission_intakes',
        row: rowNo,
        column: 'class_section',
        message: `Column "class_section": no section with the key "${classSectionKey}" was found.`,
        severity: 'error',
        value: classSectionKey,
      });
    }

    if (
      values.required_document_types !== null &&
      values.required_document_types !== undefined &&
      !Array.isArray(values.required_document_types)
    ) {
      errors.push({
        tab: 'admission_intakes',
        row: rowNo,
        column: 'required_document_types',
        message: 'Column "required_document_types": must be a JSON array, for example ["PHOTO"].',
        severity: 'error',
        value: cells.required_document_types ?? '',
      });
    }

    if (errors.length > 0) return { errors };

    return {
      row: {
        id: values.id as string,
        class_section_id: classSectionId as string,
        class_section_key: classSectionKey,
        title: values.title as string,
        seat_count: values.seat_count as number,
        open_date: values.open_date as string,
        close_date: values.close_date as string,
        required_document_types: (values.required_document_types as string[] | null) ?? [],
      },
    };
  },

  keyOf(x: AdmissionIntakeRow | AdmissionIntake): string {
    if (x instanceof AdmissionIntake) {
      const classSectionKey = x.class_section ? sectionsTab.keyOf(x.class_section) : '';
      return `${classSectionKey}|${x.title}`;
    }
    return `${x.class_section_key}|${x.title}`;
  },

  diffFields(row: AdmissionIntakeRow, existing: AdmissionIntake): string[] {
    const changed: string[] = [];
    if (row.class_section_id !== existing.class_section_id) changed.push('class_section');
    if (row.title !== existing.title) changed.push('title');
    if (row.seat_count !== existing.seat_count) changed.push('seat_count');
    if (row.open_date !== formatDateOnly(existing.open_date)) changed.push('open_date');
    if (row.close_date !== formatDateOnly(existing.close_date)) changed.push('close_date');
    if (
      JSON.stringify(row.required_document_types) !==
      JSON.stringify(existing.required_document_types)
    ) {
      changed.push('required_document_types');
    }
    return changed;
  },

  async upsert(
    row: AdmissionIntakeRow,
    existing: AdmissionIntake | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<AdmissionIntake> {
    const intake = existing ?? new AdmissionIntake();
    intake.tenant_id = tenantId;
    intake.class_section_id = row.class_section_id;
    intake.title = row.title;
    intake.seat_count = row.seat_count;
    intake.open_date = row.open_date;
    intake.close_date = row.close_date;
    intake.required_document_types =
      row.required_document_types as AdmissionIntake['required_document_types'];

    return m.save(AdmissionIntake, intake);
  },

  async remove(entity: AdmissionIntake, m: EntityManager): Promise<void> {
    await m.softRemove(AdmissionIntake, entity);
  },
};
