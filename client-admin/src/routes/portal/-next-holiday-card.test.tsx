import { REGION_BD_EN } from '@biddaloy/ui/i18n';
import { cleanupTestState, server } from '@biddaloy/ui/test';
import { formatDate, formatWeekday } from '@biddaloy/ui/utils';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderPortalCard } from './-card-test-utils';
import { NextHolidayCard } from './-next-holiday-card';

function event(name: string, type: string, start: string) {
  return {
    id: `id-${name}`,
    academic_year_id: 'year',
    type,
    name,
    description: null,
    start_date: start,
    end_date: start,
    start_time: null,
    end_time: null,
    counts_as_working_day: false,
    audience: 'ALL',
    class_ids: [],
    is_locked: false,
    published: true,
  };
}

function mock(events: unknown[]) {
  const seen: URLSearchParams[] = [];
  server.use(
    http.get('/api/v1/calendar/events', ({ request }) => {
      seen.push(new URL(request.url).searchParams);
      return HttpResponse.json({
        data: events,
        total: events.length,
        page: 1,
        limit: 6,
        totalPages: 1,
      });
    }),
  );
  return seen;
}

describe('NextHolidayCard', () => {
  afterEach(async () => {
    vi.useRealTimers();
    await cleanupTestState();
  });

  it('skips a non-holiday first event and counts days on the school clock', async () => {
    // 23 Nov 00:30 in Dhaka, still 22 Nov in the browser's UTC.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-22T18:30:00Z'));
    const seen = mock([
      event('Sports day', 'EVENT', '2026-11-25'),
      event('Victory Day', 'HOLIDAY', '2026-12-16'),
    ]);
    renderPortalCard(<NextHolidayCard />);

    expect((await screen.findAllByText('Victory Day')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Sports day')).toBeNull();
    expect(screen.getAllByText(/In 23 days/).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(
        new RegExp(
          `${formatWeekday('2026-12-16', REGION_BD_EN)}, ${formatDate('2026-12-16', REGION_BD_EN)}`,
        ),
      ).length,
    ).toBeGreaterThan(0);
    // The window starts on the school's today, not the browser's.
    expect(seen[0]?.get('from')).toBe('2026-11-23');
    expect(seen[0]?.get('to')).toBe('2027-01-22');
  });

  it('a holiday today reads "Today"', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-12-15T18:30:00Z'));
    mock([event('Victory Day', 'HOLIDAY', '2026-12-16')]);
    renderPortalCard(<NextHolidayCard />);

    expect((await screen.findAllByText(/Today/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/In \d+ day/)).toBeNull();
  });

  it('none is empty and keeps the calendar link', async () => {
    mock([event('Sports day', 'EVENT', '2026-11-25')]);
    renderPortalCard(<NextHolidayCard />);

    expect(await screen.findByText('No holiday in the next 60 days.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open calendar' }).getAttribute('href')).toMatch(
      /^\/portal\/calendar/,
    );
  });

  it('renders no h1 and is axe clean', async () => {
    mock([event('Victory Day', 'HOLIDAY', '2026-12-16')]);
    const { container } = renderPortalCard(<NextHolidayCard />);

    await screen.findAllByText('Victory Day');
    expect(screen.queryAllByRole('heading', { level: 1 })).toHaveLength(0);
    await expect(container).toHaveNoViolations();
  });
});
