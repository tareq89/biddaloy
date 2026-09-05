import '@biddaloy/ui/test';

import { RegionConfigProvider } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { AttendanceTab } from './attendance-tab';

// `renderWithProviders` doesn't wrap in `RegionConfigProvider` itself
// (unlike the real `$studentId.tsx` route, which wraps its whole tab tree
// in one built from `useTenantRegionConfig()`) — without it,
// `useRegionConfig()` falls back to the raw default context value
// (Bengali numerals) regardless of the `locale` render option. Wrapping
// here is this test's stand-in for that route-level provider.
function renderTab(studentId: string) {
  return renderWithProviders(
    <RegionConfigProvider>
      <AttendanceTab studentId={studentId} />
    </RegionConfigProvider>,
    { locale: 'en', role: 'ADMIN', tenantId: 'tenant-1' },
  );
}

// Frozen so "this month" means the same thing regardless of when the
// suite runs — same reasoning `portal/attendance.test.tsx` documents.
vi.useFakeTimers({ toFake: ['Date'] });

afterAll(() => {
  vi.useRealTimers();
});

vi.setSystemTime(new Date('2026-09-15T10:00:00.000Z'));

const STUDENT_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

function summary(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    student_id: STUDENT_ID,
    from: '2026-09-01',
    to: '2026-09-30',
    working_days: 22,
    marked_days: 10,
    present_days: 8,
    late_days: 1,
    absent_days: 1,
    leave_days: 0,
    unmarked_days: 12,
    attendance_percentage: 90,
    policy: {
      late_counts_as_present: true,
      leave_counts_as_working_day: true,
      denominator: 'WORKING_DAYS',
    },
    ...overrides,
  };
}

describe('AttendanceTab', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  function mockAttendance(options: {
    days?: unknown[];
    summaryOverrides?: Partial<Record<string, unknown>>;
    monthsRequested?: string[];
  }) {
    server.use(
      http.get('/api/v1/attendance/students/:studentId/days', ({ request }) => {
        const month = new URL(request.url).searchParams.get('month') ?? '';
        options.monthsRequested?.push(month);
        return HttpResponse.json(options.days ?? []);
      }),
      http.get('/api/v1/attendance/students/:studentId/summary', () =>
        HttpResponse.json(summary(options.summaryOverrides)),
      ),
    );
  }

  it('renders the month grid and summary figures once loaded', async () => {
    mockAttendance({
      days: [{ date: '2026-09-01', status: 'PRESENT', is_working_day: true }],
    });

    renderTab(STUDENT_ID);

    await waitFor(() => expect(screen.getByText('90%')).toBeTruthy());
    expect(screen.getByText('2026-09')).toBeTruthy();
  });

  it('steps the month back and forward, re-fetching for the new month', async () => {
    const monthsRequested: string[] = [];
    mockAttendance({ days: [], monthsRequested });

    const { user } = renderTab(STUDENT_ID);

    await waitFor(() => expect(screen.getByText('2026-09')).toBeTruthy());

    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    await waitFor(() => expect(screen.getByText('2026-08')).toBeTruthy());

    await user.click(screen.getByRole('button', { name: 'Next month' }));
    await user.click(screen.getByRole('button', { name: 'Next month' }));
    await waitFor(() => expect(screen.getByText('2026-10')).toBeTruthy());

    await waitFor(() =>
      expect(monthsRequested).toEqual(
        expect.arrayContaining(['2026-09', '2026-08', '2026-09', '2026-10']),
      ),
    );
  });

  it('shows "not enough data" instead of a bare dash when the percentage is null', async () => {
    mockAttendance({ days: [], summaryOverrides: { attendance_percentage: null } });

    renderTab(STUDENT_ID);

    await waitFor(() => expect(screen.getByText('Not enough data yet')).toBeTruthy());
  });

  it('shows an error state with retry when either query fails', async () => {
    server.use(
      http.get('/api/v1/attendance/students/:studentId/days', () =>
        HttpResponse.json({ message: 'boom' }, { status: 500 }),
      ),
      http.get('/api/v1/attendance/students/:studentId/summary', () =>
        HttpResponse.json(summary()),
      ),
    );

    renderTab(STUDENT_ID);

    await waitFor(() => expect(screen.getByText("Couldn't load attendance.")).toBeTruthy());
  });
});
