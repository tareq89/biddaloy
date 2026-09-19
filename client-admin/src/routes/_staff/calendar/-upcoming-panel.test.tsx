import '@biddaloy/ui/test';
import { CalendarAudience, CalendarEventType } from '@biddaloy/shared';
import type { CalendarEvent } from '@biddaloy/ui/hooks';
import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UpcomingPanel } from './-upcoming-panel';

afterEach(cleanupTestState);

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'ev-1',
    academic_year_id: 'ay-1',
    type: CalendarEventType.EXAM,
    name: 'Mid-term exam',
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

describe('UpcomingPanel', () => {
  it('renders nothing but the empty list when there are no events', async () => {
    renderWithProviders(<UpcomingPanel events={[]} today="2026-09-01" />, { locale: 'en' });
    expect(await screen.findByText('Upcoming')).not.toBeNull();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('excludes past events and unpublished drafts', async () => {
    renderWithProviders(
      <UpcomingPanel
        events={[
          event({ id: 'past', name: 'Past event', end_date: '2026-08-01' }),
          event({ id: 'draft', name: 'Draft event', published: false }),
          event({
            id: 'future',
            name: 'Future event',
            start_date: '2026-09-15',
            end_date: '2026-09-15',
          }),
        ]}
        today="2026-09-01"
      />,
    );

    expect(await screen.findByText('Future event')).not.toBeNull();
    expect(screen.queryByText('Past event')).toBeNull();
    expect(screen.queryByText('Draft event')).toBeNull();
  });

  it('sorts by start date and caps at the given limit', async () => {
    renderWithProviders(
      <UpcomingPanel
        events={[
          event({ id: 'e3', name: 'Third', start_date: '2026-09-20', end_date: '2026-09-20' }),
          event({ id: 'e1', name: 'First', start_date: '2026-09-10', end_date: '2026-09-10' }),
          event({ id: 'e2', name: 'Second', start_date: '2026-09-15', end_date: '2026-09-15' }),
        ]}
        today="2026-09-01"
        limit={2}
      />,
    );

    await screen.findByText('First');
    const names = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(names[0]).toContain('First');
    expect(names[1]).toContain('Second');
    expect(screen.queryByText('Third')).toBeNull();
  });

  it('calls onEventClick with the event id when a row is clicked', async () => {
    const onEventClick = vi.fn();
    const { user } = renderWithProviders(
      <UpcomingPanel
        events={[event({ name: 'Clickable' })]}
        today="2026-09-01"
        onEventClick={onEventClick}
      />,
    );

    await user.click(await screen.findByText('Clickable'));

    expect(onEventClick).toHaveBeenCalledWith('ev-1');
  });

  it('does not throw when onEventClick is omitted and a row is clicked', async () => {
    const { user } = renderWithProviders(
      <UpcomingPanel events={[event({ name: 'No handler' })]} today="2026-09-01" />,
    );

    await user.click(await screen.findByText('No handler'));
  });
});
