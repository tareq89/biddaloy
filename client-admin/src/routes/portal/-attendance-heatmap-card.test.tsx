import { cleanupTestState, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AttendanceHeatmapCard } from './-attendance-heatmap-card';
import { renderPortalCard } from './-card-test-utils';

const MONTH = '2026-11';
const KIDS = [
  { id: 'kid-a', fullName: 'Fatima Rahman' },
  { id: 'kid-b', fullName: 'Imran Rahman' },
];

const pad = (n: number) => String(n).padStart(2, '0');

/** 1-20 Nov are school days (status from `statusOf`); 21-30 are off. */
function month(statusOf: (day: number) => string | null) {
  return Array.from({ length: 30 }, (_, i) => {
    const day = i + 1;
    return {
      date: `${MONTH}-${pad(day)}`,
      status: day <= 20 ? statusOf(day) : null,
      minutes_late: null,
      remarks: null,
      is_working_day: day <= 20,
      holiday_name: null,
      marked_at: null,
    };
  });
}

function mock(statusOf: (day: number) => string | null, requested: string[] = []) {
  server.use(
    http.get('/api/v1/attendance/students/:id/days', ({ params }) => {
      requested.push(String(params.id));
      return HttpResponse.json(month(statusOf));
    }),
  );
}

function renderCard(props: { today?: string; onSelect?: (id: string) => void } = {}) {
  return renderPortalCard(
    <AttendanceHeatmapCard
      students={KIDS}
      selectedId="kid-a"
      onSelect={props.onSelect ?? (() => undefined)}
      today={props.today ?? '2026-11-25'}
      month={MONTH}
    />,
  );
}

describe('AttendanceHeatmapCard', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('19 of 20 days present, absent on 11 Nov: value 19 and the missed date named', async () => {
    mock((day) => (day === 11 ? 'ABSENT' : 'PRESENT'));
    renderCard();

    expect(await screen.findByText('19 days')).toBeTruthy();
    expect(screen.getByText('present')).toBeTruthy();
    expect(screen.getByText(/Present 19 of 20 days; missed 11th November, 2026\./)).toBeTruthy();
  });

  it('counts LATE as present', async () => {
    mock((day) => (day === 3 ? 'LATE' : 'PRESENT'));
    renderCard();

    expect(await screen.findByText('Present on all 20 school days so far.')).toBeTruthy();
    expect(screen.getByText('20 days')).toBeTruthy();
  });

  it('names at most three missed dates, then an ellipsis', async () => {
    mock((day) => (day <= 4 ? 'ABSENT' : 'PRESENT'));
    renderCard();

    expect(
      await screen.findByText(
        'Present 16 of 20 days; missed 1st November, 2026, 2nd November, 2026, 3rd November, 2026, ….',
      ),
    ).toBeTruthy();
  });

  it('no school day yet this month', async () => {
    mock(() => null);
    renderCard({ today: '2026-10-31' });

    expect(await screen.findByText('No school day yet this month.')).toBeTruthy();
  });

  it('days after today read as upcoming, not missed', async () => {
    mock((day) => (day <= 10 ? 'PRESENT' : null));
    renderCard({ today: '2026-11-10' });

    expect(await screen.findByText('Present on all 10 school days so far.')).toBeTruthy();
    expect(screen.getAllByText('Upcoming').length).toBeGreaterThan(0);
  });

  it('the picker switches child, calls onSelect and loads that child', async () => {
    const requested: string[] = [];
    mock(() => 'PRESENT', requested);
    const onSelect = vi.fn();
    renderCard({ onSelect });

    await screen.findByText('20 days');
    await userEvent.click(screen.getByRole('button', { name: 'Imran Rahman' }));
    expect(onSelect).toHaveBeenCalledWith('kid-b');
    expect(screen.getByRole('button', { name: 'Fatima Rahman' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    // Only the picked child's month is requested here.
    await waitFor(() => expect(new Set(requested)).toEqual(new Set(['kid-a'])));
  });

  it('shows no picker for one child', async () => {
    mock(() => 'PRESENT');
    renderPortalCard(
      <AttendanceHeatmapCard
        students={[KIDS[0] as (typeof KIDS)[number]]}
        selectedId="kid-a"
        onSelect={() => undefined}
        today="2026-11-25"
        month={MONTH}
      />,
    );

    await screen.findByText('20 days');
    expect(screen.queryByRole('group', { name: 'Child' })).toBeNull();
  });

  it('links to the full attendance of the picked child', async () => {
    mock(() => 'PRESENT');
    renderCard();

    const link = await screen.findByRole('link', { name: 'Full attendance' });
    expect(link.getAttribute('href')).toContain('student=kid-a');
  });

  it('error then Retry reloads the month', async () => {
    let fail = true;
    server.use(
      http.get('/api/v1/attendance/students/:id/days', () =>
        fail
          ? HttpResponse.json({ message: 'no' }, { status: 403 })
          : HttpResponse.json(month(() => 'PRESENT')),
      ),
    );
    renderCard();

    const retry = await screen.findByRole('button', { name: 'Try again' });
    fail = false;
    await userEvent.click(retry);
    expect(await screen.findByText('20 days')).toBeTruthy();
  });

  it('renders no h1 and is axe clean', async () => {
    mock(() => 'PRESENT');
    const { container } = renderCard();

    await screen.findByText('20 days');
    expect(screen.queryAllByRole('heading', { level: 1 })).toHaveLength(0);
    expect(screen.getByRole('heading', { level: 2, name: "This month's attendance" })).toBeTruthy();
    await expect(container).toHaveNoViolations();
  });
});
