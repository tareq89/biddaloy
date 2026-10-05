import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { WorkloadPanel } from './-workload-panel';

afterEach(async () => {
  await cleanupTestState();
});

function mockWorkload() {
  server.use(
    http.get('/api/v1/routines/routine-1/workload', () =>
      HttpResponse.json([
        { teacher_id: 'teacher-1', periods_per_week: 30, periods_per_day: { 0: 8, 1: 4 } },
        { teacher_id: 'teacher-2', periods_per_week: 0, periods_per_day: {} },
      ]),
    ),
    http.get('/api/v1/teachers', () =>
      HttpResponse.json({
        data: [
          { id: 'teacher-1', user: { full_name: 'Ms Nahar' } },
          { id: 'teacher-2', user: { full_name: 'Mr Karim' } },
        ],
        total: 2,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
  );
}

describe('WorkloadPanel', () => {
  it('flags a teacher over the daily cap with a badge, and reports underloaded teachers', async () => {
    mockWorkload();
    renderWithProviders(<WorkloadPanel routineId="routine-1" maxPeriodsPerTeacherPerDay={6} />, {
      tenantId: 'tenant-1',
      locale: 'en',
    });

    await waitFor(() => expect(screen.getByText('Ms Nahar')).toBeTruthy());
    expect(screen.getByText('over daily limit')).toBeTruthy();
    expect(screen.getByText('Mr Karim')).toBeTruthy();
    expect(screen.getByText(/1 teacher has no periods assigned/)).toBeTruthy();
  });

  it('does not flag anyone over-limit with no cap configured', async () => {
    mockWorkload();
    renderWithProviders(<WorkloadPanel routineId="routine-1" maxPeriodsPerTeacherPerDay={null} />, {
      tenantId: 'tenant-1',
      locale: 'en',
    });

    await waitFor(() => expect(screen.getByText('Ms Nahar')).toBeTruthy());
    expect(screen.queryByText(/over daily limit/)).toBeNull();
  });
});

describe('WorkloadPanel unknown teacher', () => {
  it('shows a dash, never the teacher id', async () => {
    server.use(
      http.get('/api/v1/routines/routine-1/workload', () =>
        HttpResponse.json([
          { teacher_id: 'teacher-gone', periods_per_week: 3, periods_per_day: {} },
        ]),
      ),
      http.get('/api/v1/teachers', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 1 }),
      ),
    );
    renderWithProviders(<WorkloadPanel routineId="routine-1" />, {
      tenantId: 'tenant-1',
      locale: 'en',
    });

    await waitFor(() => expect(screen.getByRole('table')).toBeTruthy());
    expect(screen.queryByText('teacher-gone')).toBeNull();
  });
});
