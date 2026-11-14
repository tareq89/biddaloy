import type { EntityManager } from 'typeorm';
import { AdmissionDocumentType, AdmissionPayMethod, AdmissionTemplateKey } from '@biddaloy/shared';
import { AdmissionIntake } from '../../../admission/entities/admission-intake.entity';
import { fromCell, formatDateOnly } from '../../codec/cell-format';
import { optionalKeyOf } from '../../codec/tab-spec';
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
  class_section_id: string | null;
  class_section_key: string;
  class_id: string | null;
  academic_year_id: string | null;
  template_key: string;
  roll_prefix: string | null;
  roll_counter: number;
  fee_amount_paisa: number | null;
  fee_pay_methods: string[];
  form_fields: string[];
  publish_channels: string[];
  tie_break: string[];
  show_names_publicly: boolean;
  widget_always_show: boolean;
  auto_activate_lists: boolean;
  title: string;
  seat_count: number;
  open_date: string;
  close_date: string;
  required_document_types: string[];
}

const JSON_LISTS: ReadonlyArray<[string, string, string]> = [
  ['fee_pay_methods', 'Fee pay methods', 'ফি পরিশোধের মাধ্যম'],
  ['form_fields', 'Form fields', 'ফর্মের ঘর'],
  ['publish_channels', 'Publish channels', 'প্রকাশের মাধ্যম'],
  ['tie_break', 'Tie break', 'টাই ব্রেক'],
];
const FLAGS: ReadonlyArray<[string, string, string]> = [
  ['show_names_publicly', 'Show names publicly', 'নাম প্রকাশ্যে দেখানো'],
  ['widget_always_show', 'Always show widget', 'উইজেট সবসময় দেখানো'],
  ['auto_activate_lists', 'Auto-activate lists', 'তালিকা স্বয়ংক্রিয় সক্রিয়'],
];
const PAY_METHODS = new Set<string>(Object.values(AdmissionPayMethod));
const INT4_MAX = 2147483647;

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  {
    key: 'class_section',
    type: 'ref',
    ref: 'sections',
    // Blank for pipeline rounds ([Epic 71]): admit picks the section.
    label: { en: 'Class section', bn: 'শ্রেণী শাখা' },
  },
  { key: 'class', type: 'ref', ref: 'classes', label: { en: 'Class', bn: 'শ্রেণী' } },
  {
    key: 'academic_year',
    type: 'ref',
    ref: 'academic_years',
    label: { en: 'Academic year', bn: 'শিক্ষাবর্ষ' },
  },
  {
    key: 'template_key',
    type: 'enum',
    required: true,
    enumValues: Object.values(AdmissionTemplateKey),
    label: { en: 'Template', bn: 'টেমপ্লেট' },
  },
  { key: 'roll_prefix', type: 'string', label: { en: 'Roll prefix', bn: 'রোল প্রিফিক্স' } },
  {
    key: 'roll_counter',
    type: 'int',
    required: true,
    label: { en: 'Roll counter', bn: 'রোল কাউন্টার' },
  },
  {
    key: 'fee_amount_paisa',
    type: 'int',
    label: { en: 'Fee (paisa)', bn: 'ফি (পয়সা)' },
  },
  ...JSON_LISTS.map(([key, en, bn]): ColumnSpec => ({ key, type: 'json', label: { en, bn } })),
  ...FLAGS.map(([key, en, bn]): ColumnSpec => ({
    key,
    type: 'bool',
    required: true,
    label: { en, bn },
  })),
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
  'class_id', // exported instead as the `class` ref column
  'academic_year_id', // exported instead as the `academic_year` ref column
];

const MAX_LENGTHS: Record<string, number> = {
  title: 200,
  roll_prefix: 20,
};

export const admissionIntakesTab: TabSpec<AdmissionIntake, AdmissionIntakeRow> = {
  name: 'admission_intakes',
  entity: AdmissionIntake,
  excluded,
  dependsOn: ['sections', 'classes', 'academic_years'],
  columns,
  // Includes both dates — `IntakeService.create` allows more than one
  // intake with the same section+title (e.g. re-running the same admission
  // window next year), and a natural key on section+title alone would
  // collide the two, making a workbook with both unrestorable.
  naturalKey: ['class_section', 'title', 'open_date', 'close_date'],
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
      class_section: entity.class_section_id
        ? ctx.keyOf('sections', entity.class_section_id)
        : null,
      title: entity.title,
      seat_count: entity.seat_count,
      open_date: entity.open_date,
      close_date: entity.close_date,
      required_document_types: entity.required_document_types ?? [],
      class: entity.class_id ? optionalKeyOf(ctx, 'classes', entity.class_id) : null,
      academic_year: entity.academic_year_id
        ? optionalKeyOf(ctx, 'academic_years', entity.academic_year_id)
        : null,
      template_key: entity.template_key,
      roll_prefix: entity.roll_prefix,
      roll_counter: entity.roll_counter,
      fee_amount_paisa: entity.fee_amount_paisa,
      fee_pay_methods: entity.fee_pay_methods ?? [],
      form_fields: entity.form_fields ?? [],
      publish_channels: entity.publish_channels ?? [],
      tie_break: entity.tie_break ?? [],
      show_names_publicly: entity.show_names_publicly,
      widget_always_show: entity.widget_always_show,
      auto_activate_lists: entity.auto_activate_lists,
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

    const classSectionKey = (values.class_section as string | null) ?? '';
    const classSectionId = classSectionKey ? (ctx.ref('sections', classSectionKey) ?? null) : null;
    if (classSectionKey && !classSectionId) {
      errors.push({
        tab: 'admission_intakes',
        row: rowNo,
        column: 'class_section',
        message: 'Column "class_section": no such section was found.',
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
    } else if (Array.isArray(values.required_document_types)) {
      const validTypes = new Set<string>(Object.values(AdmissionDocumentType));
      const invalid = values.required_document_types.filter(
        (value) => typeof value !== 'string' || !validTypes.has(value),
      );
      if (invalid.length > 0) {
        errors.push({
          tab: 'admission_intakes',
          row: rowNo,
          column: 'required_document_types',
          message:
            'Column "required_document_types": has a value that is not a supported document type.',
          severity: 'error',
          value: cells.required_document_types ?? '',
        });
      }
    }

    if ((values.open_date as string) > (values.close_date as string)) {
      errors.push({
        tab: 'admission_intakes',
        row: rowNo,
        column: 'close_date',
        message: 'Column "close_date": must not be earlier than "open_date".',
        severity: 'error',
        value: cells.close_date ?? '',
      });
    }

    if (typeof values.seat_count === 'number' && values.seat_count < 0) {
      errors.push({
        tab: 'admission_intakes',
        row: rowNo,
        column: 'seat_count',
        message: 'Column "seat_count": must not be negative.',
        severity: 'error',
        value: cells.seat_count ?? '',
      });
    } else if (typeof values.seat_count === 'number' && values.seat_count > 2147483647) {
      // Postgres `int` column max — a larger value would fail at `m.save`
      // with a raw DB error instead of a reported row error.
      errors.push({
        tab: 'admission_intakes',
        row: rowNo,
        column: 'seat_count',
        message: 'Column "seat_count": must not exceed 2147483647.',
        severity: 'error',
        value: cells.seat_count ?? '',
      });
    }

    const bad = (column: string, message: string) =>
      errors.push({
        tab: 'admission_intakes',
        row: rowNo,
        column,
        message,
        severity: 'error',
        value: cells[column] ?? '',
      });
    const refId = (column: 'class' | 'academic_year', tab: string): string | null => {
      const key = (values[column] as string | null) ?? '';
      if (!key) return null;
      const id = ctx.ref(tab, key);
      if (!id) bad(column, `Column "${column}": no such row was found.`);
      return id ?? null;
    };
    const classId = refId('class', 'classes');
    const academicYearId = refId('academic_year', 'academic_years');
    const lists: Record<string, string[]> = {};
    for (const [key] of JSON_LISTS) {
      const v = values[key];
      if (v == null) lists[key] = [];
      else if (!Array.isArray(v) || v.some((x) => typeof x !== 'string'))
        bad(key, `Column "${key}": must be a JSON array of text, for example [].`);
      else lists[key] = v as string[];
    }
    if ((lists.fee_pay_methods ?? []).some((x) => !PAY_METHODS.has(x)))
      bad('fee_pay_methods', 'Column "fee_pay_methods": has a value that is not a pay method.');
    // DB CHECK CHK_admission_intakes_fee_amount, and bigint kept a safe integer (Rule 5, 26).
    const fee = values.fee_amount_paisa as number | null;
    if (fee !== null && (fee < 0 || !Number.isSafeInteger(fee)))
      bad('fee_amount_paisa', 'Column "fee_amount_paisa": must be a whole number, not negative.');
    const counter = values.roll_counter as number;
    if (counter < 0 || counter > INT4_MAX)
      bad('roll_counter', 'Column "roll_counter": is out of range.');

    if (errors.length > 0) return { errors };

    return {
      row: {
        id: values.id as string,
        class_section_id: classSectionId,
        class_section_key: classSectionKey,
        class_id: classId,
        academic_year_id: academicYearId,
        template_key: values.template_key as string,
        roll_prefix: (values.roll_prefix as string | null) ?? null,
        roll_counter: counter,
        fee_amount_paisa: fee,
        fee_pay_methods: lists.fee_pay_methods,
        form_fields: lists.form_fields,
        publish_channels: lists.publish_channels,
        tie_break: lists.tie_break,
        show_names_publicly: values.show_names_publicly as boolean,
        widget_always_show: values.widget_always_show as boolean,
        auto_activate_lists: values.auto_activate_lists as boolean,
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
      return `${classSectionKey}|${x.title}|${formatDateOnly(x.open_date)}|${formatDateOnly(x.close_date)}`;
    }
    return `${x.class_section_key}|${x.title}|${x.open_date}|${x.close_date}`;
  },

  diffFields(row: AdmissionIntakeRow, existing: AdmissionIntake): string[] {
    const changed: string[] = [];
    if (row.class_section_id !== existing.class_section_id) changed.push('class_section');
    if (row.class_id !== existing.class_id) changed.push('class');
    if (row.academic_year_id !== existing.academic_year_id) changed.push('academic_year');
    if (row.template_key !== existing.template_key) changed.push('template_key');
    if (row.roll_prefix !== existing.roll_prefix) changed.push('roll_prefix');
    if (row.roll_counter !== existing.roll_counter) changed.push('roll_counter');
    if (row.fee_amount_paisa !== existing.fee_amount_paisa) changed.push('fee_amount_paisa');
    for (const [key] of JSON_LISTS) {
      const mine = row[key as keyof AdmissionIntakeRow];
      if (JSON.stringify(mine) !== JSON.stringify(existing[key as keyof AdmissionIntake]))
        changed.push(key);
    }
    for (const [key] of FLAGS) {
      if (row[key as keyof AdmissionIntakeRow] !== existing[key as keyof AdmissionIntake])
        changed.push(key);
    }
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
    intake.class_id = row.class_id;
    intake.academic_year_id = row.academic_year_id;
    intake.template_key = row.template_key as AdmissionIntake['template_key'];
    intake.roll_prefix = row.roll_prefix;
    intake.roll_counter = row.roll_counter;
    intake.fee_amount_paisa = row.fee_amount_paisa;
    intake.fee_pay_methods = row.fee_pay_methods as AdmissionIntake['fee_pay_methods'];
    intake.form_fields = row.form_fields;
    intake.publish_channels = row.publish_channels;
    intake.tie_break = row.tie_break;
    intake.show_names_publicly = row.show_names_publicly;
    intake.widget_always_show = row.widget_always_show;
    intake.auto_activate_lists = row.auto_activate_lists;
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
