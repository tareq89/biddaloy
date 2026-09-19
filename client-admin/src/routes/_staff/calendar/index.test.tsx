import '@biddaloy/ui/test';

import { CalendarAudience, CalendarEventType } from '@biddaloy/shared';
import { ApiError, type ApiErrorBody } from '@biddaloy/ui/api';
import {
  AgendaList,
  type AgendaEvent,
  MonthGrid,
  type MonthGridEvent,
} from '@biddaloy/ui/components';
import type { CalendarEvent, PublicHolidayEntry } from '@biddaloy/ui/hooks';
import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EventDetailsSheet } from './-event-details-sheet';
import { EventFormDialog } from './-event-form-dialog';
import { GovernmentHolidaysDialog } from './-government-holidays-dialog';

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
