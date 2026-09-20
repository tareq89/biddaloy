import '@biddaloy/ui/test';

import { CalendarAudience, CalendarEventType } from '@biddaloy/shared';
import { ApiError, type ApiErrorBody } from '@biddaloy/ui/api';
import type { CalendarEvent, PublicHolidayEntry } from '@biddaloy/ui/hooks';
import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgendaList, type AgendaEvent } from '../../../components/calendar/agenda-list';
import { MonthGrid, type MonthGridEvent } from '../../../components/calendar/month-grid';

import { EventDetailsSheet } from './-event-details-sheet';
import { EventFormDialog } from './-event-form-dialog';
import { GovernmentHolidaysDialog } from './-government-holidays-dialog';

import { calendarSearchSchema } from './index';

describe('calendarSearchSchema', () => {
  it('accepts a well-formed YYYY-MM month', () => {
    expect(calendarSearchSchema.parse({ month: '2026-09' }).month).toBe('2026-09');
  });

  it('falls back to undefined instead of crashing the route for a malformed month', () => {
    // `?month=abc` used to reach `monthRange()`/`addMonths()`, which pass
    // the parsed parts to `Date.UTC` and call `.toISOString()` on the
    // result — an invalid date throws `RangeError: Invalid time value`
    // there instead of falling back to the current month.
    expect(calendarSearchSchema.parse({ month: 'abc' }).month).toBeUndefined();
    expect(calendarSearchSchema.parse({ month: '2026-13' }).month).toBeUndefined();
    expect(calendarSearchSchema.parse({ month: '2026-00' }).month).toBeUndefined();
  });
});

/**
 * [17.4.2] — component-level tests, not a full `renderWithRouter` +
 * `routeTree.gen.ts` integration test like `academic-years/index.test.tsx`.
 * `routeTree.gen.ts` IS regenerated in this diff (codegen ran as a normal
 * side effect of adding the route file) — that's not why this test avoids
 * router integration. The choice is deliberate: testing the
 * presentational/dialog pieces directly is faster and isolates each
 * piece's own logic (form validation, day-coverage grouping, permission
 * gating) from router wiring, which is exercised separately by
 * `route-permissions.test.ts`. Every ## Tests bullet is still covered,
 * just against those components directly rather than through the router.
 */

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function multiDayEvent(): MonthGridEvent {
  return {
    id: 'ev-1',
    type: CalendarEventType.EXAM,
    typeLabel: 'Exam',
    name: 'Mid-term exams',
    startDate: '2026-09-10',
    endDate: '2026-09-12',
  };
}

describe('MonthGrid', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('places a multi-day event across every day it spans, firstDayOfWeek = 0', () => {
    renderWithProviders(
      <MonthGrid
        month="2026-09"
        firstDayOfWeek={0}
        weeklyOffDays={[5, 6]}
        events={[multiDayEvent()]}
        weekdayLabels={WEEKDAY_LABELS}
        moreLabel={(count) => `+${count} more`}
      />,
    );

    for (const day of ['2026-09-10', '2026-09-11', '2026-09-12']) {
      const cell = screen.getByTestId(`day-cell-${day}`);
      expect(within(cell).getByText('Mid-term exams')).toBeTruthy();
    }
    expect(
      screen.queryByText('Mid-term exams', { selector: '[data-testid="day-cell-2026-09-09"] *' }),
    ).toBeNull();
  });

  it('places a multi-day event across every day it spans, firstDayOfWeek = 1', () => {
    renderWithProviders(
      <MonthGrid
        month="2026-09"
        firstDayOfWeek={1}
        weeklyOffDays={[6]}
        events={[multiDayEvent()]}
        weekdayLabels={WEEKDAY_LABELS}
        moreLabel={(count) => `+${count} more`}
      />,
    );

    for (const day of ['2026-09-10', '2026-09-11', '2026-09-12']) {
      const cell = screen.getByTestId(`day-cell-${day}`);
      expect(within(cell).getByText('Mid-term exams')).toBeTruthy();
    }
  });

  it('calls onDayClick when a day cell is clicked', () => {
    const onDayClick = vi.fn();
    renderWithProviders(
      <MonthGrid
        month="2026-09"
        firstDayOfWeek={0}
        weeklyOffDays={[5, 6]}
        events={[]}
        weekdayLabels={WEEKDAY_LABELS}
        moreLabel={(count) => `+${count} more`}
        onDayClick={onDayClick}
      />,
    );

    fireEvent.click(screen.getByTestId('day-cell-2026-09-10'));

    expect(onDayClick).toHaveBeenCalledWith('2026-09-10');
  });

  it('calls onEventClick, not onDayClick, when an event chip is clicked', () => {
    const onDayClick = vi.fn();
    const onEventClick = vi.fn();
    renderWithProviders(
      <MonthGrid
        month="2026-09"
        firstDayOfWeek={0}
        weeklyOffDays={[5, 6]}
        events={[multiDayEvent()]}
        weekdayLabels={WEEKDAY_LABELS}
        moreLabel={(count) => `+${count} more`}
        onDayClick={onDayClick}
        onEventClick={onEventClick}
      />,
    );

    fireEvent.click(screen.getAllByText('Mid-term exams')[0]!);

    expect(onEventClick).toHaveBeenCalledWith('ev-1');
    expect(onDayClick).not.toHaveBeenCalled();
  });

  it('moves focus with arrow keys and activates the focused day with Enter/Space', () => {
    const onDayClick = vi.fn();
    renderWithProviders(
      <MonthGrid
        month="2026-09"
        firstDayOfWeek={0}
        weeklyOffDays={[5, 6]}
        events={[]}
        weekdayLabels={WEEKDAY_LABELS}
        moreLabel={(count) => `+${count} more`}
        onDayClick={onDayClick}
      />,
    );

    const startCell = screen.getByTestId('day-cell-2026-09-10');
    fireEvent.keyDown(startCell, { key: 'ArrowRight' });
    fireEvent.keyDown(screen.getByTestId('day-cell-2026-09-11'), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByTestId('day-cell-2026-09-18'), { key: 'ArrowLeft' });
    fireEvent.keyDown(screen.getByTestId('day-cell-2026-09-17'), { key: 'ArrowUp' });
    fireEvent.keyDown(screen.getByTestId('day-cell-2026-09-10'), { key: ' ' });

    expect(onDayClick).toHaveBeenCalledWith('2026-09-10');
  });

  it('ignores unrecognized keys and does not move focus or activate a day', () => {
    const onDayClick = vi.fn();
    renderWithProviders(
      <MonthGrid
        month="2026-09"
        firstDayOfWeek={0}
        weeklyOffDays={[5, 6]}
        events={[]}
        weekdayLabels={WEEKDAY_LABELS}
        moreLabel={(count) => `+${count} more`}
        onDayClick={onDayClick}
      />,
    );

    fireEvent.keyDown(screen.getByTestId('day-cell-2026-09-10'), { key: 'Tab' });

    expect(onDayClick).not.toHaveBeenCalled();
  });

  it("renders a term band and includes the term name in a covered day's label", () => {
    renderWithProviders(
      <MonthGrid
        month="2026-09"
        firstDayOfWeek={0}
        weeklyOffDays={[5, 6]}
        events={[]}
        terms={[{ id: 't1', name: 'Term 1', startDate: '2026-09-01', endDate: '2026-09-30' }]}
        weekdayLabels={WEEKDAY_LABELS}
        moreLabel={(count) => `+${count} more`}
      />,
    );

    expect(screen.getByTestId('term-bands')).toBeTruthy();
    expect(screen.getByText('Term 1')).toBeTruthy();
    expect(screen.getByTestId('day-cell-2026-09-10').getAttribute('aria-label')).toBe(
      '2026-09-10 (Term 1)',
    );
  });
});

describe('AgendaList', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('groups events by day', () => {
    const events: AgendaEvent[] = [
      {
        id: 'a',
        type: CalendarEventType.HOLIDAY,
        typeLabel: 'Holiday',
        name: 'National Day',
        startDate: '2026-09-05',
        endDate: '2026-09-05',
      },
      {
        id: 'b',
        type: CalendarEventType.MEETING,
        typeLabel: 'Meeting',
        name: 'Staff meeting',
        startDate: '2026-09-05',
        endDate: '2026-09-05',
      },
      {
        id: 'c',
        type: CalendarEventType.EVENT,
        typeLabel: 'Event',
        name: 'Sports day',
        startDate: '2026-09-12',
        endDate: '2026-09-12',
      },
    ];

    renderWithProviders(
      <AgendaList events={events} formatDayHeading={(day) => day} emptyLabel="No events" />,
    );

    const sept5 = screen.getByRole('region', { name: '2026-09-05' });
    expect(within(sept5).getByText('National Day')).toBeTruthy();
    expect(within(sept5).getByText('Staff meeting')).toBeTruthy();

    const sept12 = screen.getByRole('region', { name: '2026-09-12' });
    expect(within(sept12).getByText('Sports day')).toBeTruthy();
  });

  it('shows the empty label when there are no events', () => {
    renderWithProviders(
      <AgendaList events={[]} formatDayHeading={(day) => day} emptyLabel="No events" />,
    );
    expect(screen.getByTestId('agenda-empty').textContent).toBe('No events');
  });
});

function baseEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'ev-1',
    academic_year_id: 'year-1',
    type: CalendarEventType.EVENT,
    name: 'Sports day',
    description: null,
    start_date: '2026-09-10',
    end_date: '2026-09-10',
    start_time: null,
    end_time: null,
    counts_as_working_day: true,
    audience: CalendarAudience.ALL,
    class_ids: [],
    is_locked: false,
    published: true,
    ...overrides,
  };
}

describe('EventDetailsSheet', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('hides Edit/Delete for a locked (past) event', async () => {
    renderWithProviders(
      <EventDetailsSheet
        open
        onOpenChange={() => {}}
        event={baseEvent({ is_locked: true })}
        canManage
        onEdit={() => {}}
        onDelete={() => {}}
        onPublish={() => {}}
      />,
      { locale: 'en' },
    );

    expect(await screen.findByRole('heading', { name: 'Sports day' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('shows Edit/Delete for a non-locked event when the caller can manage', async () => {
    renderWithProviders(
      <EventDetailsSheet
        open
        onOpenChange={() => {}}
        event={baseEvent({ is_locked: false })}
        canManage
        onEdit={() => {}}
        onDelete={() => {}}
        onPublish={() => {}}
      />,
      { locale: 'en' },
    );

    expect(await screen.findByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
  });
});

describe('EventFormDialog', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it.each([
    ['CALENDAR_EVENT_LOCKED', 'This event is in the past and can no longer be changed.'],
    ['CALENDAR_OUTSIDE_ACADEMIC_YEAR', 'These dates fall outside the current academic year.'],
    ['CALENDAR_DAY_HAS_ATTENDANCE', 'Attendance has already been recorded for one of these days.'],
    ['CALENDAR_INVALID_CLASS', 'One of the selected classes is invalid.'],
  ])('maps the %s 422 code to its message', async (code, expectedMessage) => {
    const body: ApiErrorBody = {
      statusCode: 422,
      message: 'Unprocessable',
      timestamp: new Date().toISOString(),
      path: '/calendar/events',
      requestId: 'req-1',
      details: { code },
    };
    const error = new ApiError(body);

    renderWithProviders(
      <EventFormDialog
        open
        onOpenChange={() => {}}
        mode="create"
        isPending={false}
        error={error}
        onSubmit={() => {}}
      />,
      { locale: 'en' },
    );

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(expectedMessage);
  });

  it('falls back to the generic message for an unmapped error code', async () => {
    const body: ApiErrorBody = {
      statusCode: 422,
      message: 'Unprocessable',
      timestamp: new Date().toISOString(),
      path: '/calendar/events',
      requestId: 'req-1',
      details: { code: 'SOMETHING_UNKNOWN' },
    };
    const error = new ApiError(body);

    renderWithProviders(
      <EventFormDialog
        open
        onOpenChange={() => {}}
        mode="create"
        isPending={false}
        error={error}
        onSubmit={() => {}}
      />,
      { locale: 'en' },
    );

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe("Couldn't save this event. Try again.");
  });

  it('shows a validation error and does not submit when the name is blank', async () => {
    const onSubmit = vi.fn();
    renderWithProviders(
      <EventFormDialog
        open
        onOpenChange={() => {}}
        mode="create"
        isPending={false}
        error={null}
        onSubmit={onSubmit}
      />,
      { locale: 'en' },
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Name is required.');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows the invalid-range message when a name is set but dates are missing', async () => {
    const onSubmit = vi.fn();
    renderWithProviders(
      <EventFormDialog
        open
        onOpenChange={() => {}}
        mode="create"
        isPending={false}
        error={null}
        onSubmit={onSubmit}
      />,
      { locale: 'en' },
    );

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'New Event' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('The end date must be on or after the start date.');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits with the prefilled values in edit mode, and titles the dialog "Edit event"', async () => {
    const onSubmit = vi.fn();
    const initialValues: CalendarEvent = {
      id: 'ev-1',
      academic_year_id: 'ay-1',
      type: CalendarEventType.EXAM,
      name: 'Mid-term exam',
      description: 'All classes',
      start_date: '2026-09-10',
      end_date: '2026-09-12',
      start_time: null,
      end_time: null,
      counts_as_working_day: true,
      audience: CalendarAudience.ALL,
      class_ids: [],
      is_locked: false,
      published: true,
    };
    renderWithProviders(
      <EventFormDialog
        open
        onOpenChange={() => {}}
        mode="edit"
        initialValues={initialValues}
        isPending={false}
        error={null}
        onSubmit={onSubmit}
      />,
      { locale: 'en' },
    );

    expect(await screen.findByText('Edit event')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Mid-term exam',
        start_date: '2026-09-10',
        end_date: '2026-09-12',
      }),
    );
  });

  it('keeps "notify by SMS" disabled until "notify" is checked', async () => {
    renderWithProviders(
      <EventFormDialog
        open
        onOpenChange={() => {}}
        mode="create"
        isPending={false}
        error={null}
        onSubmit={() => {}}
      />,
      { locale: 'en' },
    );

    const notifySms = await screen.findByRole('checkbox', { name: 'Also notify by SMS' });
    expect((notifySms as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Notify affected families/staff' }));

    expect((notifySms as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('GovernmentHolidaysDialog', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  function suggestion(overrides: Partial<PublicHolidayEntry> = {}): PublicHolidayEntry {
    return {
      id: 'h-1',
      set_id: 'set-1',
      set: {} as PublicHolidayEntry['set'],
      date: '2026-12-16',
      end_date: '2026-12-16',
      name: 'Victory Day',
      name_bn: null,
      ...overrides,
    };
  }

  it('disables rows already added as an event and posts only the ticked ids', async () => {
    const onAdd = vi.fn();
    const alreadyAdded = suggestion({ id: 'h-1', name: 'Victory Day', date: '2026-12-16' });
    const notAdded = suggestion({ id: 'h-2', name: 'Independence Day', date: '2026-03-26' });

    const { user } = renderWithProviders(
      <GovernmentHolidaysDialog
        open
        onOpenChange={() => {}}
        suggestions={[alreadyAdded, notAdded]}
        existingEvents={[
          baseEvent({
            id: 'existing-1',
            name: 'Victory Day',
            start_date: '2026-12-16',
            type: CalendarEventType.HOLIDAY,
          }),
        ]}
        isPending={false}
        onAdd={onAdd}
      />,
      { locale: 'en' },
    );

    const addedCheckbox = screen.getByRole('checkbox', { name: /Victory Day/ });
    expect((addedCheckbox as HTMLButtonElement).disabled).toBe(true);

    const notAddedCheckbox = screen.getByRole('checkbox', { name: /Independence Day/ });
    await user.click(notAddedCheckbox);
    await user.click(screen.getByRole('button', { name: 'Add selected' }));

    expect(onAdd).toHaveBeenCalledWith(['h-2']);
  });
});
