import type { EntityManager } from 'typeorm';
import { CalendarEventType, CalendarAudience } from '@biddaloy/shared';
import { CalendarEvent } from '../../../calendar/entities/calendar-event.entity';
import { CalendarEventClass } from '../../../calendar/entities/calendar-event-class.entity';
import { fromCell, formatDateOnly } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';

/**
 * The `calendar_events` tab: full `CalendarEvent` shape (17.2.5) — holidays,
 * exams, events, meetings, deadlines. Renamed from `holidays.tab.ts`
 * ([17.1.2] widened `CalendarEvent` past holiday-only); this is the "later
 * Epic 17 task" that file's excluded-columns comment promised.
 *
 * A workbook written before this rename may still carry a `holidays` sheet
 * instead of `calendar_events`. `readWorkbook` (`codec/workbook-codec.ts`)
 * aliases that legacy sheet name onto this tab so an old backup keeps
 * restoring; rows read that way arrive here with no `type`/`audience`/
 * `published` cells, so those columns default rather than being `required`
 * (D17: `type = HOLIDAY`, `audience = ALL`, `published = true`).
 *
 * `academic_year` and `classes` are the only `ref`/`ref-list` columns: cells
 * hold the referenced rows' own natural keys, never raw ids.
 */

export interface CalendarEventRow {
  id: string;
  academic_year_id: string;
  type: CalendarEventType;
  name: string;
  description: string | null;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  counts_as_working_day: boolean;
  audience: CalendarAudience;
  published: boolean;
  class_ids: string[];
  // Referenced tabs' own natural-key text, kept alongside the resolved
  // local ids so `keyOf` can build the same key format for both a
  // freshly-imported row and an existing entity.
  academic_year_key: string;
  class_keys: string[];
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  {
    key: 'academic_year',
    type: 'ref',
    ref: 'academic_years',
    required: true,
    label: { en: 'Academic year', bn: 'শিক্ষাবর্ষ' },
  },
  {
    // Not required: a legacy `holidays` sheet has no `type` cell at all.
    key: 'type',
    type: 'enum',
    enumValues: Object.values(CalendarEventType),
    label: { en: 'Type', bn: 'ধরন' },
  },
  { key: 'name', type: 'string', required: true, label: { en: 'Name', bn: 'নাম' } },
  { key: 'description', type: 'string', label: { en: 'Description', bn: 'বিবরণ' } },
  {
    key: 'start_date',
    type: 'date',
    required: true,
    label: { en: 'Start date', bn: 'শুরুর তারিখ' },
  },
  { key: 'end_date', type: 'date', required: true, label: { en: 'End date', bn: 'শেষের তারিখ' } },
  { key: 'start_time', type: 'string', label: { en: 'Start time', bn: 'শুরুর সময়' } },
  { key: 'end_time', type: 'string', label: { en: 'End time', bn: 'শেষের সময়' } },
  {
    key: 'counts_as_working_day',
    type: 'bool',
    required: true,
    label: { en: 'Counts as working day', bn: 'কার্যদিবস হিসেবে গণনা' },
  },
  {
    // Not required, same reasoning as `type`.
    key: 'audience',
    type: 'enum',
    enumValues: Object.values(CalendarAudience),
    label: { en: 'Audience', bn: 'দর্শক' },
  },
  {
    // Not required: absent on a legacy `holidays` row, defaults to
    // published (D17) same as a fresh restore's own default.
    key: 'published',
    type: 'bool',
    label: { en: 'Published', bn: 'প্রকাশিত' },
  },
  {
    key: 'classes',
    type: 'ref-list',
    ref: 'classes',
    label: { en: 'Classes', bn: 'শ্রেণী' },
  },
];

/**
 * Entity columns deliberately left out of the workbook. The completeness
 * gate (`registry.completeness.spec.ts`) fails if a new `CalendarEvent`
 * column appears in neither `columns` nor here.
 */
const excluded: readonly string[] = [
  'academic_year_id', // exported instead as the `academic_year` ref column, keyed by the referenced tab's natural key
  'published_at', // exported instead as the boolean `published` column
  'external_refs', // opaque internal bookkeeping, not user-editable data
  'created_by_user_id', // not user-editable, no matching "restoring user" concept in a workbook
  'updated_by_user_id', // same as created_by_user_id
];

const MAX_LENGTHS: Record<string, number> = {
  name: 120,
};

// `start_time`/`end_time` are plain `string` columns (no `time` ColumnType
// exists in this codec), so `fromRow` must validate the format itself — a
// value like "not-a-time" would otherwise reach `m.save` and fail the
// whole restore operation when Postgres rejects it for the `time` column,
// instead of failing just this one row.
const TIME_ONLY = /^\d{2}:\d{2}(:\d{2})?$/;

function isValidTime(value: string): boolean {
  if (!TIME_ONLY.test(value)) return false;
  const [hours, minutes] = value.split(':').map(Number);
  return hours! >= 0 && hours! <= 23 && minutes! >= 0 && minutes! <= 59;
}

export const calendarEventsTab: TabSpec<CalendarEvent, CalendarEventRow> = {
  name: 'calendar_events',
  entity: CalendarEvent,
  excluded,
  dependsOn: ['academic_years', 'classes'],
  columns,
  naturalKey: ['academic_year', 'name', 'start_date'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<CalendarEvent[]> {
    // `academic_year` is loaded eagerly: `keyOf` needs the year's own name
    // (its natural key), never its uuid. `classes`/`classes.class`/
    // `classes.class.academic_year` are loaded so `toRow` can build each
    // scoped class's own natural key.
    return m.find(CalendarEvent, {
      where: { tenant_id: tenantId },
      relations: ['academic_year', 'classes', 'classes.class', 'classes.class.academic_year'],
    });
  },

  toRow(entity: CalendarEvent, ctx: ExportContext): Record<string, unknown> {
    const classKeys = (entity.classes ?? [])
      .map((link) => ctx.keyOf('classes', link.class_id))
      // Sorted so the exported cell is stable regardless of the order
      // Postgres returns join rows in.
      .sort();

    return {
      id: entity.id,
      academic_year: ctx.keyOf('academic_years', entity.academic_year_id),
      type: entity.type,
      name: entity.name,
      description: entity.description,
      start_date: entity.start_date,
      end_date: entity.end_date,
      start_time: entity.start_time,
      end_time: entity.end_time,
      counts_as_working_day: entity.counts_as_working_day,
      audience: entity.audience,
      published: entity.published_at !== null,
      classes: classKeys,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: CalendarEventRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'calendar_events', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }

      const limit = MAX_LENGTHS[column.key];
      if (limit !== undefined && typeof result.value === 'string' && result.value.length > limit) {
        errors.push({
          tab: 'calendar_events',
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

    let academicYearId: string | undefined;
    const academicYearKey = values.academic_year as string;
    if (academicYearKey) {
      academicYearId = ctx.ref('academic_years', academicYearKey);
      if (!academicYearId) {
        errors.push({
          tab: 'calendar_events',
          row: rowNo,
          column: 'academic_year',
          message: `Column "academic_year": no academic year named "${academicYearKey}" was found.`,
          severity: 'error',
          value: academicYearKey,
        });
      }
    }

    const classKeys = (values.classes as string[]) ?? [];
    const classIdSet = new Set<string>();
    for (const key of classKeys) {
      const resolved = ctx.ref('classes', key);
      if (!resolved) {
        errors.push({
          tab: 'calendar_events',
          row: rowNo,
          column: 'classes',
          message: `Column "classes": no class named "${key}" was found.`,
          severity: 'error',
          value: key,
        });
        continue;
      }
      // A class's own natural key is `${name}|${academicYearKey}` (see
      // classes.tab.ts's keyOf) — the year portion is already right there
      // in the cell text, no extra lookup needed to catch a class scoped
      // to a *different* academic year than this event's own. Without
      // this check, `upsert` would link the event to a class from another
      // year — `calendar_event_classes` has no DB constraint enforcing
      // the years match, unlike the live API's `assertClassesInTenant`.
      const classYearKey = key.slice(key.indexOf('|') + 1);
      if (academicYearKey && classYearKey !== academicYearKey) {
        errors.push({
          tab: 'calendar_events',
          row: rowNo,
          column: 'classes',
          message: `Column "classes": "${key}" belongs to a different academic year than this event ("${academicYearKey}").`,
          severity: 'error',
          value: key,
        });
        continue;
      }
      classIdSet.add(resolved);
    }

    for (const [column, value] of [
      ['start_time', values.start_time],
      ['end_time', values.end_time],
    ] as const) {
      if (value && !isValidTime(value as string)) {
        errors.push({
          tab: 'calendar_events',
          row: rowNo,
          column,
          message: `Column "${column}": "${value}" is not a valid HH:MM time.`,
          severity: 'error',
          value: value as string,
        });
      }
    }

    if (errors.length > 0) return { errors };

    const startDate = values.start_date as string;
    const endDate = values.end_date as string;
    if (endDate < startDate) {
      errors.push({
        tab: 'calendar_events',
        row: rowNo,
        column: 'end_date',
        message: `Column "end_date": "${endDate}" is before "start_date" ("${startDate}").`,
        severity: 'error',
        value: endDate,
      });
      return { errors };
    }

    return {
      row: {
        id: values.id as string,
        academic_year_id: academicYearId as string,
        // D17: a legacy `holidays` sheet has no `type`/`audience`/`published`
        // cells at all — default them the same way a fresh restore would.
        type: (values.type as CalendarEventType | null) ?? CalendarEventType.HOLIDAY,
        name: values.name as string,
        description: (values.description as string | null) ?? null,
        start_date: startDate,
        end_date: endDate,
        start_time: (values.start_time as string | null) ?? null,
        end_time: (values.end_time as string | null) ?? null,
        counts_as_working_day: values.counts_as_working_day as boolean,
        audience: (values.audience as CalendarAudience | null) ?? CalendarAudience.ALL,
        published: (values.published as boolean | null) ?? true,
        class_ids: Array.from(classIdSet),
        academic_year_key: academicYearKey,
        class_keys: classKeys,
      },
    };
  },

  keyOf(x: CalendarEventRow | CalendarEvent): string {
    // A natural key is never a uuid (see key-index.ts): a row carries the
    // year's key text directly, an entity must read it off the (eagerly
    // loaded) `academic_year` relation.
    const yearKey =
      x instanceof CalendarEvent ? (x.academic_year?.name ?? '') : x.academic_year_key;
    return `${yearKey}|${x.name}|${formatDateOnly(x.start_date)}`;
  },

  diffFields(row: CalendarEventRow, existing: CalendarEvent): string[] {
    const changed: string[] = [];
    if (row.academic_year_id !== existing.academic_year_id) changed.push('academic_year');
    if (row.type !== existing.type) changed.push('type');
    if (row.name !== existing.name) changed.push('name');
    if (row.description !== existing.description) changed.push('description');
    if (row.start_date !== formatDateOnly(existing.start_date)) changed.push('start_date');
    if (row.end_date !== formatDateOnly(existing.end_date)) changed.push('end_date');
    if (row.start_time !== existing.start_time) changed.push('start_time');
    if (row.end_time !== existing.end_time) changed.push('end_time');
    if (row.counts_as_working_day !== existing.counts_as_working_day) {
      changed.push('counts_as_working_day');
    }
    if (row.audience !== existing.audience) changed.push('audience');
    if (row.published !== (existing.published_at !== null)) changed.push('published');

    const rowClassKey = [...row.class_ids].sort().join(';');
    const existingClassKey = (existing.classes ?? [])
      .map((link) => link.class_id)
      .sort()
      .join(';');
    if (rowClassKey !== existingClassKey) changed.push('classes');

    return changed;
  },

  async upsert(
    row: CalendarEventRow,
    existing: CalendarEvent | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<CalendarEvent> {
    const event = existing ?? new CalendarEvent();
    event.tenant_id = tenantId;
    event.academic_year_id = row.academic_year_id;
    event.type = row.type;
    event.name = row.name;
    event.description = row.description;
    event.start_date = row.start_date;
    event.end_date = row.end_date;
    event.start_time = row.start_time;
    event.end_time = row.end_time;
    event.counts_as_working_day = row.counts_as_working_day;
    event.audience = row.audience;
    // [17.1.2] D9 — a draft (published_at IS NULL) event never affects
    // working days. `row.published` is `true` unless the cell explicitly
    // said otherwise (or was absent, per the legacy-sheet default above).
    if (row.published) {
      if (!event.published_at) event.published_at = new Date();
    } else {
      event.published_at = null;
    }

    const saved = await m.save(CalendarEvent, event);

    const currentLinks = await m
      .createQueryBuilder()
      .relation(CalendarEvent, 'classes')
      .of(saved)
      .loadMany<CalendarEventClass>();
    const currentClassIds = new Set(currentLinks.map((link) => link.class_id));
    const desiredClassIds = new Set(row.class_ids);

    const toAdd = row.class_ids.filter((id) => !currentClassIds.has(id));
    const toRemove = [...currentClassIds].filter((id) => !desiredClassIds.has(id));

    if (toAdd.length > 0) {
      await m
        .createQueryBuilder()
        .insert()
        .into(CalendarEventClass)
        .values(toAdd.map((classId) => ({ event_id: saved.id, class_id: classId })))
        .execute();
    }
    if (toRemove.length > 0) {
      await m
        .createQueryBuilder()
        .delete()
        .from(CalendarEventClass)
        .where('event_id = :eventId AND class_id IN (:...classIds)', {
          eventId: saved.id,
          classIds: toRemove,
        })
        .execute();
    }

    return saved;
  },

  async remove(entity: CalendarEvent, m: EntityManager): Promise<void> {
    await m.softRemove(CalendarEvent, entity);
  },
};
