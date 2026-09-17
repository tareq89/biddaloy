import { describe, expect, it } from 'vitest';
import { CalendarEventType, CalendarAudience } from '@biddaloy/shared';
import { AcademicYear } from '../../../academics/entities/academic-year.entity';
import { CalendarEvent } from '../../../calendar/entities/calendar-event.entity';
import { CalendarEventClass } from '../../../calendar/entities/calendar-event-class.entity';
import { Class } from '../../../academics/entities/class.entity';
import { cellText, toCell } from '../../codec/cell-format';
import { assertRegistryValid } from '../../codec/registry';
import type { ExportContext, ImportContext } from '../../codec/tab-spec';
import { academicYearsTab } from './academic-years.tab';
import { classesTab } from './classes.tab';
import { calendarEventsTab, type CalendarEventRow } from './calendar-events.tab';
import { academicsTabs } from './index';

const EVENT_ID = '7f3e4b2a-1c5d-4e8f-9a6b-2d1c3e4f5a6e';
const YEAR_ID = '22222222-2222-4222-8222-222222222222';
const CLASS_ID = '33333333-3333-4333-8333-333333333333';
const TENANT_ID = '11111111-1111-4111-8111-111111111111';

const exportCtx: ExportContext = {
  keyOf: (tab, id) => {
    if (tab === 'academic_years' && id === YEAR_ID) return '2026-2027';
    if (tab === 'classes' && id === CLASS_ID) return 'Class 5|2026-2027';
    return '';
  },
};

function makeImportCtx(overrides: Partial<ImportContext> = {}): ImportContext {
  return {
    tenantId: TENANT_ID,
    ref: (tab, key) => {
      if (tab === 'academic_years' && key === '2026-2027') return YEAR_ID;
      if (tab === 'classes' && key === 'Class 5|2026-2027') return CLASS_ID;
      return undefined;
    },
    warn: () => undefined,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return Object.assign(new CalendarEvent(), {
    id: EVENT_ID,
    academic_year_id: YEAR_ID,
    academic_year: Object.assign(new AcademicYear(), { id: YEAR_ID, name: '2026-2027' }),
    type: CalendarEventType.HOLIDAY,
    name: 'Winter break',
    description: null,
    start_date: '2026-12-20',
    end_date: '2026-12-31',
    start_time: null,
    end_time: null,
    counts_as_working_day: false,
    audience: CalendarAudience.ALL,
    published_at: new Date('2026-01-01T00:00:00Z'),
    classes: [],
    tenant_id: TENANT_ID,
    ...overrides,
  } satisfies Partial<CalendarEvent>);
}

function toCells(event: CalendarEvent): Record<string, string> {
  const row = calendarEventsTab.toRow(event, exportCtx);
  const cells: Record<string, string> = {};
  for (const column of calendarEventsTab.columns) {
    const cell = toCell(column.type, row[column.key]);
    cells[column.key] = cellText(cell === null ? '' : String(cell));
  }
  return cells;
}

describe('calendarEventsTab shape', () => {
  it('is registered through the academics barrel, after academic_years', () => {
    expect(academicsTabs).toContain(calendarEventsTab);
    expect(academicsTabs.indexOf(calendarEventsTab)).toBeGreaterThan(
      academicsTabs.indexOf(academicYearsTab),
    );
  });

  it('is the last tab in registration order', () => {
    expect(academicsTabs[academicsTabs.length - 1]).toBe(calendarEventsTab);
  });

  it('satisfies the registry contract together with academic_years and classes', () => {
    expect(() =>
      assertRegistryValid([academicYearsTab, classesTab, calendarEventsTab], { partial: true }),
    ).not.toThrow();
  });

  it('depends on academic_years and classes, deletes by absence', () => {
    expect(calendarEventsTab.name).toBe('calendar_events');
    expect(calendarEventsTab.dependsOn).toEqual(['academic_years', 'classes']);
    expect(calendarEventsTab.naturalKey).toEqual(['academic_year', 'name', 'start_date']);
    expect(calendarEventsTab.deleteByAbsence).toBe(true);
  });

  it('keys an event by year, name, and start date, never a uuid', () => {
    const key = calendarEventsTab.keyOf(makeEvent());
    expect(key).toBe('2026-2027|Winter break|2026-12-20');
    expect(key).not.toContain(EVENT_ID);
    expect(key).not.toContain(YEAR_ID);
  });
});

describe('round trip', () => {
  it('returns equivalent values through toRow then fromRow', () => {
    const link = Object.assign(new CalendarEventClass(), {
      event_id: EVENT_ID,
      class_id: CLASS_ID,
      class: Object.assign(new Class(), { id: CLASS_ID }),
    });
    const event = makeEvent({ classes: [link] });

    const result = calendarEventsTab.fromRow(toCells(event), 2, makeImportCtx());

    expect(result).toEqual({
      row: {
        id: EVENT_ID,
        academic_year_id: YEAR_ID,
        type: CalendarEventType.HOLIDAY,
        name: 'Winter break',
        description: null,
        start_date: '2026-12-20',
        end_date: '2026-12-31',
        start_time: null,
        end_time: null,
        counts_as_working_day: false,
        audience: CalendarAudience.ALL,
        published: true,
        class_ids: [CLASS_ID],
        academic_year_key: '2026-2027',
        class_keys: ['Class 5|2026-2027'],
      } satisfies CalendarEventRow,
    });
  });

  it('reports a RowError naming the column and key on a ref miss', () => {
    const cells = { ...toCells(makeEvent()), academic_year: 'nonexistent-year' };

    const result = calendarEventsTab.fromRow(cells, 3, makeImportCtx());

    expect('errors' in result).toBe(true);
    if (!('errors' in result)) return;
    expect(result.errors[0]).toMatchObject({
      column: 'academic_year',
      row: 3,
      value: 'nonexistent-year',
    });
  });

  it('rejects a missing required name', () => {
    const cells = { ...toCells(makeEvent()), name: '' };

    const result = calendarEventsTab.fromRow(cells, 2, makeImportCtx());

    expect('errors' in result).toBe(true);
    if (!('errors' in result)) return;
    expect(result.errors[0].column).toBe('name');
  });

  it('rejects an end_date before start_date', () => {
    const cells = {
      ...toCells(makeEvent()),
      start_date: '2026-12-31',
      end_date: '2026-12-20',
    };

    const result = calendarEventsTab.fromRow(cells, 2, makeImportCtx());

    expect('errors' in result).toBe(true);
    if (!('errors' in result)) return;
    expect(result.errors[0]).toMatchObject({ column: 'end_date' });
  });

  it('accepts an end_date equal to start_date (a single-day event)', () => {
    const cells = {
      ...toCells(makeEvent()),
      start_date: '2026-12-20',
      end_date: '2026-12-20',
    };

    const result = calendarEventsTab.fromRow(cells, 2, makeImportCtx());

    expect('errors' in result).toBe(false);
  });

  it('reports a RowError naming the column and key on a class ref miss', () => {
    const cells = { ...toCells(makeEvent()), classes: 'nonexistent-class' };

    const result = calendarEventsTab.fromRow(cells, 4, makeImportCtx());

    expect('errors' in result).toBe(true);
    if (!('errors' in result)) return;
    expect(result.errors[0]).toMatchObject({
      column: 'classes',
      row: 4,
      value: 'nonexistent-class',
    });
  });
});

describe('legacy `holidays` sheet defaults (D17)', () => {
  it('defaults type, audience, and published when those cells are absent', () => {
    // A row read from an old `holidays` sheet (via readWorkbook's legacy
    // alias) carries no cells for `type`/`audience`/`published` at all —
    // simulated here by omitting them entirely, the same shape `fromCell`
    // produces for an empty, non-required cell.
    const cells = { ...toCells(makeEvent()) };
    delete cells.type;
    delete cells.audience;
    delete cells.published;

    const result = calendarEventsTab.fromRow(cells, 2, makeImportCtx());

    expect('row' in result).toBe(true);
    if (!('row' in result)) return;
    expect(result.row.type).toBe(CalendarEventType.HOLIDAY);
    expect(result.row.audience).toBe(CalendarAudience.ALL);
    expect(result.row.published).toBe(true);
  });
});

describe('diffFields', () => {
  it('reports no changes for an identical row', () => {
    const event = makeEvent();
    const row: CalendarEventRow = {
      id: EVENT_ID,
      academic_year_id: YEAR_ID,
      type: CalendarEventType.HOLIDAY,
      name: 'Winter break',
      description: null,
      start_date: '2026-12-20',
      end_date: '2026-12-31',
      start_time: null,
      end_time: null,
      counts_as_working_day: false,
      audience: CalendarAudience.ALL,
      published: true,
      class_ids: [],
      academic_year_key: '2026-2027',
      class_keys: [],
    };

    expect(calendarEventsTab.diffFields(row, event)).toEqual([]);
  });

  it('reports a changed counts_as_working_day', () => {
    const event = makeEvent();
    const row: CalendarEventRow = {
      id: EVENT_ID,
      academic_year_id: YEAR_ID,
      type: CalendarEventType.HOLIDAY,
      name: 'Winter break',
      description: null,
      start_date: '2026-12-20',
      end_date: '2026-12-31',
      start_time: null,
      end_time: null,
      counts_as_working_day: true,
      audience: CalendarAudience.ALL,
      published: true,
      class_ids: [],
      academic_year_key: '2026-2027',
      class_keys: [],
    };

    expect(calendarEventsTab.diffFields(row, event)).toEqual(['counts_as_working_day']);
  });
});
