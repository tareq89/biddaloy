import type { EntityManager } from 'typeorm';
import { RoutineSlot } from '../../../routines/entities/routine-slot.entity';
import { SlotRecurrence } from '@biddaloy/shared';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';
import { routinesTab } from './routines.tab';
import { sectionsTab } from '../academics/sections.tab';
import { periodSlotsTab } from './period-slots.tab';

/**
 * The `routine_slots` tab: one scheduled class — section, period, weekday,
 * subject, effective `[valid_from, valid_to)` — within a routine.
 *
 * D4 (see `RoutineSlot`'s docstring) means two rows can legitimately share
 * `(routine, section, period_slot, weekday)` with disjoint date ranges — a
 * mid-year subject swap ends one row and starts another. `valid_from` is
 * therefore part of the natural key, not just the four identifying
 * columns, so an ended row and its replacement don't collide on export.
 *
 * `room` is the only nullable `ref` column: not every scheduled class has
 * a fixed room.
 */

export interface RoutineSlotRow {
  id: string;
  routine_id: string;
  routine_key: string;
  section_id: string;
  section_key: string;
  period_slot_id: string;
  period_slot_key: string;
  weekday: number;
  subject_id: string;
  subject_key: string;
  room_id: string | null;
  room_key: string | null;
  recurrence: SlotRecurrence;
  recurrence_offset: number;
  valid_from: string;
  valid_to: string | null;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  {
    key: 'routine',
    type: 'ref',
    ref: 'routines',
    required: true,
    label: { en: 'Routine', bn: 'রুটিন' },
  },
  {
    key: 'section',
    type: 'ref',
    ref: 'sections',
    required: true,
    label: { en: 'Section', bn: 'শাখা' },
  },
  {
    key: 'period_slot',
    type: 'ref',
    ref: 'period_slots',
    required: true,
    label: { en: 'Period', bn: 'পিরিয়ড' },
  },
  { key: 'weekday', type: 'int', required: true, label: { en: 'Weekday', bn: 'বার' } },
  {
    key: 'subject',
    type: 'ref',
    ref: 'subjects',
    required: true,
    label: { en: 'Subject', bn: 'বিষয়' },
  },
  { key: 'room', type: 'ref', ref: 'rooms', label: { en: 'Room', bn: 'কক্ষ' } },
  {
    key: 'recurrence',
    type: 'enum',
    enumValues: Object.values(SlotRecurrence),
    required: true,
    label: { en: 'Recurrence', bn: 'পুনরাবৃত্তি' },
  },
  {
    key: 'recurrence_offset',
    type: 'int',
    required: true,
    label: { en: 'Recurrence offset', bn: 'পুনরাবৃত্তি অফসেট' },
  },
  { key: 'valid_from', type: 'date', required: true, label: { en: 'Valid from', bn: 'শুরু' } },
  { key: 'valid_to', type: 'date', label: { en: 'Valid to', bn: 'শেষ' } },
];

/**
 * Entity columns deliberately left out of the workbook. The completeness
 * gate (`registry.completeness.spec.ts`) fails if a new `RoutineSlot`
 * column appears in neither `columns` nor here.
 */
const excluded: readonly string[] = [
  'routine_id', // exported instead as the `routine` ref column
  'section_id', // exported instead as the `section` ref column
  'period_slot_id', // exported instead as the `period_slot` ref column
  'subject_id', // exported instead as the `subject` ref column
  'room_id', // exported instead as the `room` ref column
];

export const routineSlotsTab: TabSpec<RoutineSlot, RoutineSlotRow> = {
  name: 'routine_slots',
  entity: RoutineSlot,
  excluded,
  dependsOn: ['routines', 'sections', 'period_slots', 'subjects', 'rooms'],
  columns,
  naturalKey: ['routine', 'section', 'period_slot', 'weekday', 'valid_from'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<RoutineSlot[]> {
    return m.find(RoutineSlot, {
      where: { tenant_id: tenantId },
      relations: [
        'routine',
        'routine.academic_year',
        'section',
        'section.class',
        'section.class.academic_year',
        'period_slot',
        'period_slot.shift',
        'subject',
        'room',
      ],
    });
  },

  toRow(entity: RoutineSlot, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      routine: ctx.keyOf('routines', entity.routine_id),
      section: ctx.keyOf('sections', entity.section_id),
      period_slot: ctx.keyOf('period_slots', entity.period_slot_id),
      weekday: entity.weekday,
      subject: ctx.keyOf('subjects', entity.subject_id),
      room: entity.room_id ? ctx.keyOf('rooms', entity.room_id) : null,
      recurrence: entity.recurrence,
      recurrence_offset: entity.recurrence_offset,
      valid_from: entity.valid_from,
      valid_to: entity.valid_to,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: RoutineSlotRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'routine_slots', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }
      values[column.key] = result.value;
    }

    if (errors.length > 0) return { errors };

    const routineKey = values.routine as string;
    const sectionKey = values.section as string;
    const periodSlotKey = values.period_slot as string;
    const subjectKey = values.subject as string;
    const roomKey = (values.room as string | null) ?? null;

    const routineId = ctx.ref('routines', routineKey);
    if (!routineId) {
      errors.push({
        tab: 'routine_slots',
        row: rowNo,
        column: 'routine',
        message: `Column "routine": no routine named "${routineKey}" was found.`,
        severity: 'error',
        value: routineKey,
      });
    }

    const sectionId = ctx.ref('sections', sectionKey);
    if (!sectionId) {
      errors.push({
        tab: 'routine_slots',
        row: rowNo,
        column: 'section',
        message: `Column "section": no section named "${sectionKey}" was found.`,
        severity: 'error',
        value: sectionKey,
      });
    }

    const periodSlotId = ctx.ref('period_slots', periodSlotKey);
    if (!periodSlotId) {
      errors.push({
        tab: 'routine_slots',
        row: rowNo,
        column: 'period_slot',
        message: `Column "period_slot": no period slot named "${periodSlotKey}" was found.`,
        severity: 'error',
        value: periodSlotKey,
      });
    }

    const subjectId = ctx.ref('subjects', subjectKey);
    if (!subjectId) {
      errors.push({
        tab: 'routine_slots',
        row: rowNo,
        column: 'subject',
        message: `Column "subject": no subject named "${subjectKey}" was found.`,
        severity: 'error',
        value: subjectKey,
      });
    }

    let roomId: string | null = null;
    if (roomKey) {
      roomId = ctx.ref('rooms', roomKey) ?? null;
      if (!roomId) {
        errors.push({
          tab: 'routine_slots',
          row: rowNo,
          column: 'room',
          message: `Column "room": no room named "${roomKey}" was found.`,
          severity: 'error',
          value: roomKey,
        });
      }
    }

    if (errors.length > 0) return { errors };

    return {
      row: {
        id: values.id as string,
        routine_id: routineId as string,
        routine_key: routineKey,
        section_id: sectionId as string,
        section_key: sectionKey,
        period_slot_id: periodSlotId as string,
        period_slot_key: periodSlotKey,
        weekday: values.weekday as number,
        subject_id: subjectId as string,
        subject_key: subjectKey,
        room_id: roomId,
        room_key: roomKey,
        recurrence: values.recurrence as SlotRecurrence,
        recurrence_offset: values.recurrence_offset as number,
        valid_from: values.valid_from as string,
        valid_to: (values.valid_to as string | null) ?? null,
      },
    };
  },

  keyOf(x: RoutineSlotRow | RoutineSlot): string {
    // A natural key is never a uuid (see key-index.ts): a row carries the
    // referenced tabs' key text directly, an entity must derive it from
    // the (eagerly loaded) relations by delegating to each referenced
    // tab's own `keyOf`, the same pattern `sections.tab.ts` uses for its
    // `class` reference.
    if (x instanceof RoutineSlot) {
      const routineKey = x.routine ? routinesTab.keyOf(x.routine) : '';
      const sectionKey = x.section ? sectionsTab.keyOf(x.section) : '';
      const periodSlotKey = x.period_slot ? periodSlotsTab.keyOf(x.period_slot) : '';
      return `${routineKey}|${sectionKey}|${periodSlotKey}|${x.weekday}|${x.valid_from}`;
    }
    return `${x.routine_key}|${x.section_key}|${x.period_slot_key}|${x.weekday}|${x.valid_from}`;
  },

  diffFields(row: RoutineSlotRow, existing: RoutineSlot): string[] {
    const changed: string[] = [];
    if (row.routine_id !== existing.routine_id) changed.push('routine');
    if (row.section_id !== existing.section_id) changed.push('section');
    if (row.period_slot_id !== existing.period_slot_id) changed.push('period_slot');
    if (row.weekday !== existing.weekday) changed.push('weekday');
    if (row.subject_id !== existing.subject_id) changed.push('subject');
    if (row.room_id !== existing.room_id) changed.push('room');
    if (row.recurrence !== existing.recurrence) changed.push('recurrence');
    if (row.recurrence_offset !== existing.recurrence_offset) changed.push('recurrence_offset');
    if (row.valid_from !== existing.valid_from) changed.push('valid_from');
    if (row.valid_to !== existing.valid_to) changed.push('valid_to');
    return changed;
  },

  async upsert(
    row: RoutineSlotRow,
    existing: RoutineSlot | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<RoutineSlot> {
    const slot = existing ?? new RoutineSlot();
    slot.tenant_id = tenantId;
    slot.routine_id = row.routine_id;
    slot.section_id = row.section_id;
    slot.period_slot_id = row.period_slot_id;
    slot.weekday = row.weekday;
    slot.subject_id = row.subject_id;
    slot.room_id = row.room_id;
    slot.recurrence = row.recurrence;
    slot.recurrence_offset = row.recurrence_offset;
    slot.valid_from = row.valid_from;
    slot.valid_to = row.valid_to;

    return m.save(RoutineSlot, slot);
  },

  async remove(entity: RoutineSlot, m: EntityManager): Promise<void> {
    await m.remove(RoutineSlot, entity);
  },
};
