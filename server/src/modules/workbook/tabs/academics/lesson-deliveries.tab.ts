import type { EntityManager } from 'typeorm';
import { LessonDeliveryReason, LessonDeliveryStatus } from '@biddaloy/shared';
import { LessonDelivery } from '../../../study-plans/entities/lesson-delivery.entity';
import { formatDateOnly, fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';
import { sectionsTab } from './sections.tab';
import { periodSlotsTab } from '../routines/period-slots.tab';

/**
 * The `lesson_deliveries` tab (Epic 66.0, [66.1.03]): one row per
 * (section, date, period). `fromRow` repeats the migration's two CHECKs so a
 * bad row is a row error, not a failed restore.
 */
export interface LessonDeliveryRow {
  id: string;
  section_id: string;
  subject_id: string;
  date: string;
  period_slot_id: string;
  status: LessonDeliveryStatus;
  reason: LessonDeliveryReason | null;
  note: string | null;
  is_extra: boolean;
  auto: boolean;
  recorded_by_user_id: string | null;
  section_key: string;
  period_slot_key: string;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
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
  { key: 'date', type: 'date', required: true, label: { en: 'Date', bn: 'তারিখ' } },
  {
    key: 'period_slot',
    type: 'ref',
    ref: 'period_slots',
    required: true,
    label: { en: 'Period', bn: 'পিরিয়ড' },
  },
  {
    key: 'status',
    type: 'enum',
    required: true,
    enumValues: Object.values(LessonDeliveryStatus),
    label: { en: 'Status', bn: 'অবস্থা' },
  },
  {
    key: 'reason',
    type: 'enum',
    enumValues: Object.values(LessonDeliveryReason),
    label: { en: 'Reason', bn: 'কারণ' },
  },
  { key: 'note', type: 'string', label: { en: 'Note', bn: 'মন্তব্য' } },
  { key: 'is_extra', type: 'bool', required: true, label: { en: 'Extra', bn: 'অতিরিক্ত' } },
  { key: 'auto', type: 'bool', required: true, label: { en: 'Automatic', bn: 'স্বয়ংক্রিয়' } },
  {
    key: 'recorded_by',
    type: 'ref',
    ref: 'users',
    label: { en: 'Recorded by', bn: 'রেকর্ডকারী' },
  },
];

const excluded: readonly string[] = [
  'section_id', // exported instead as the `section` ref column
  'subject_id', // exported instead as the `subject` ref column
  'period_slot_id', // exported instead as the `period_slot` ref column
  'recorded_by_user_id', // exported instead as the `recorded_by` ref column
];

export const lessonDeliveriesTab: TabSpec<LessonDelivery, LessonDeliveryRow> = {
  name: 'lesson_deliveries',
  entity: LessonDelivery,
  excluded,
  dependsOn: ['sections', 'subjects', 'period_slots', 'users'],
  columns,
  naturalKey: ['section', 'date', 'period_slot'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<LessonDelivery[]> {
    return m.find(LessonDelivery, {
      where: { tenant_id: tenantId },
      // `keyOf` reads the section's class/year and the slot's shift name.
      relations: [
        'section',
        'section.class',
        'section.class.academic_year',
        'period_slot',
        'period_slot.shift',
      ],
    });
  },

  toRow(entity: LessonDelivery, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      section: ctx.keyOf('sections', entity.section_id),
      subject: ctx.keyOf('subjects', entity.subject_id),
      date: entity.date,
      period_slot: ctx.keyOf('period_slots', entity.period_slot_id),
      status: entity.status,
      reason: entity.reason,
      note: entity.note,
      is_extra: entity.is_extra,
      auto: entity.auto,
      recorded_by: entity.recorded_by_user_id
        ? ctx.keyOf('users', entity.recorded_by_user_id)
        : null,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: LessonDeliveryRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};
    const fail = (column: string, message: string, value?: string) =>
      errors.push({
        tab: 'lesson_deliveries',
        row: rowNo,
        column,
        message: `Column "${column}": ${message}`,
        severity: 'error',
        value,
      });

    for (const column of columns) {
      const result = fromCell(column, cells[column.key] ?? '', 'lesson_deliveries', rowNo);
      if ('error' in result) errors.push(result.error);
      else values[column.key] = result.value;
    }
    if (errors.length > 0) return { errors };

    const status = values.status as LessonDeliveryStatus;
    const reason = (values.reason as LessonDeliveryReason | null) ?? null;
    const notTaught = status === LessonDeliveryStatus.NOT_TAUGHT;
    if (notTaught && !reason) fail('reason', 'is required when the status is NOT_TAUGHT.');
    if (!notTaught && reason)
      fail('reason', 'must be empty unless the status is NOT_TAUGHT.', reason);
    if (notTaught && values.is_extra) fail('is_extra', 'an extra period cannot be NOT_TAUGHT.');

    const sectionKey = values.section as string;
    const sectionId = ctx.ref('sections', sectionKey);
    if (!sectionId) fail('section', `no section "${sectionKey}" was found.`, sectionKey);

    const subjectKey = values.subject as string;
    const subjectId = ctx.ref('subjects', subjectKey);
    if (!subjectId) fail('subject', `no subject with code "${subjectKey}" was found.`, subjectKey);

    const slotKey = values.period_slot as string;
    const slotId = ctx.ref('period_slots', slotKey);
    if (!slotId) fail('period_slot', `no period "${slotKey}" was found.`, slotKey);

    const userKey = values.recorded_by as string | null;
    let userId: string | null = null;
    if (userKey) {
      userId = ctx.ref('users', userKey) ?? null;
      if (!userId) fail('recorded_by', `no user "${userKey}" was found.`, userKey);
    }

    if (errors.length > 0) return { errors };

    return {
      row: {
        id: values.id as string,
        section_id: sectionId as string,
        subject_id: subjectId as string,
        date: formatDateOnly(values.date),
        period_slot_id: slotId as string,
        status,
        reason,
        note: (values.note as string | null) ?? null,
        is_extra: values.is_extra as boolean,
        auto: values.auto as boolean,
        recorded_by_user_id: userId,
        section_key: sectionKey,
        period_slot_key: slotKey,
      },
    };
  },

  keyOf(x: LessonDeliveryRow | LessonDelivery): string {
    const isEntity = x instanceof LessonDelivery;
    const sectionKey = isEntity ? (x.section ? sectionsTab.keyOf(x.section) : '') : x.section_key;
    const slotKey = isEntity
      ? x.period_slot
        ? periodSlotsTab.keyOf(x.period_slot)
        : ''
      : x.period_slot_key;
    return `${sectionKey}|${formatDateOnly(x.date)}|${slotKey}`;
  },

  diffFields(row: LessonDeliveryRow, existing: LessonDelivery): string[] {
    const changed: string[] = [];
    if (row.subject_id !== existing.subject_id) changed.push('subject');
    if (row.status !== existing.status) changed.push('status');
    if (row.reason !== existing.reason) changed.push('reason');
    if (row.note !== existing.note) changed.push('note');
    if (row.is_extra !== existing.is_extra) changed.push('is_extra');
    if (row.auto !== existing.auto) changed.push('auto');
    if (row.recorded_by_user_id !== existing.recorded_by_user_id) changed.push('recorded_by');
    return changed;
  },

  async upsert(
    row: LessonDeliveryRow,
    existing: LessonDelivery | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<LessonDelivery> {
    const delivery = existing ?? new LessonDelivery();
    delivery.tenant_id = tenantId;
    delivery.section_id = row.section_id;
    delivery.subject_id = row.subject_id;
    delivery.date = row.date;
    delivery.period_slot_id = row.period_slot_id;
    delivery.status = row.status;
    delivery.reason = row.reason;
    delivery.note = row.note;
    delivery.is_extra = row.is_extra;
    delivery.auto = row.auto;
    delivery.recorded_by_user_id = row.recorded_by_user_id;
    // Loaded relations would override the FK columns set above on save.
    delivery.section = undefined as never;
    delivery.subject = undefined as never;
    delivery.period_slot = undefined as never;
    delivery.recorded_by = null;
    return m.save(LessonDelivery, delivery);
  },

  async remove(entity: LessonDelivery, m: EntityManager): Promise<void> {
    await m.remove(LessonDelivery, entity);
  },
};
