import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

// `register.tsx`'s search schema validates these with `z.string().uuid()`,
// which (unlike `reports.tsx`, whose filters bag isn't schema-validated)
// enforces the real RFC 4122 variant nibble — a same-digit placeholder
// like `1111...` silently fails that check and gets dropped by `.catch()`.
const CLASS_ID = '11111111-1111-4111-8111-111111111111';
const SECTION_ID = '22222222-2222-4222-8222-222222222222';

function dates31(month: string) {
  return Array.from({ length: 31 }, (_, i) => ({
    date: `${month}-${String(i + 1).padStart(2, '0')}`,
    is_working_day: true,
  }));
}

function registerRow(overrides: Record<string, unknown> = {}) {
  return {
    student_id: 'student-1',
    roll_number: 4,
    full_name: 'Karim Rahman',
    marks: { '2026-01-01': 'PRESENT', '2026-01-02': 'ABSENT' },
    summary: {
      student_id: 'student-1',
      from: '2026-01-01',
      to: '2026-01-31',
      working_days: 26,
      marked_days: 20,
      present_days: 18,
      late_days: 1,
      absent_days: 1,
      leave_days: 0,
      unmarked_days: 6,
      attendance_percentage: 90,
      policy: {
        late_counts_as_present: true,
        leave_counts_as_working_day: true,
        denominator: 'WORKING_DAYS',
      },
    },
    ...overrides,
  };
}

describe('/attendance/register', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('prompts for a section instead of fetching anything when none is selected', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/register'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() =>
      expect(
        screen.getByText('Pick a class, section and month to generate the register.'),
      ).toBeTruthy(),
    );
  });

  it('renders 31 day columns plus totals, each cell carrying an sr-only status word, for a 31-day month', async () => {
    server.use(
      http.get('/api/v1/attendance/sections/:sectionId/register-matrix', () =>
        HttpResponse.json({ dates: dates31('2026-01'), rows: [registerRow()] }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: [
        `/attendance/register?class_id=${CLASS_ID}&section_id=${SECTION_ID}&month=2026-01`,
      ],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const table = await screen.findByRole('table');
    // 31 day columns + Roll + Student + 5 total columns = 38 header cells.
    expect(within(table).getAllByRole('columnheader')).toHaveLength(38);

    // Not just the visible "P"/"A" abbreviation — an accessible full word
    // per day cell too. `getAllByText` (not `getByText`) since "Present"/
    // "Absent" also legitimately appear once as this table's own
    // "Present"/"Absent" total-column headers.
    expect(within(table).getAllByText('Present').length).toBeGreaterThan(1);
    expect(within(table).getAllByText('Absent').length).toBeGreaterThan(1);
  });

  it('shows an unrecognized status raw instead of a blank cell', async () => {
    server.use(
      http.get('/api/v1/attendance/sections/:sectionId/register-matrix', () =>
        HttpResponse.json({
          dates: [{ date: '2026-01-01', is_working_day: true }],
          // A status this client doesn't know about yet — the DTO cast
          // in register.tsx is a type assertion, not a validation, so the
          // server can send anything.
          rows: [registerRow({ marks: { '2026-01-01': 'HALF_DAY' } })],
        }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: [
        `/attendance/register?class_id=${CLASS_ID}&section_id=${SECTION_ID}&month=2026-01`,
      ],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('table');
    expect(screen.getByText('?')).toBeTruthy();
    expect(screen.getByText('HALF_DAY')).toBeTruthy();
  });

  it('names class, section and month in the table caption', async () => {
    server.use(
      http.get('/api/v1/classes', () =>
        HttpResponse.json({
          data: [{ id: CLASS_ID, name: 'Class 5', section_count: 1, student_count: 30 }],
          total: 1,
          page: 1,
          limit: 20,
          totalPages: 1,
        }),
      ),
      http.get('/api/v1/classes/:classId/sections', () =>
        HttpResponse.json([{ id: SECTION_ID, section_name: 'A', enrolled_count: 30 }]),
      ),
      http.get('/api/v1/attendance/sections/:sectionId/register-matrix', () =>
        HttpResponse.json({ dates: dates31('2026-01'), rows: [registerRow()] }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: [
        `/attendance/register?class_id=${CLASS_ID}&section_id=${SECTION_ID}&month=2026-01`,
      ],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() =>
      expect(screen.getByText('Attendance register — Class 5 A, 2026-01')).toBeTruthy(),
    );
  });

  it('shows an empty state when the section has no students', async () => {
    server.use(
      http.get('/api/v1/attendance/sections/:sectionId/register-matrix', () =>
        HttpResponse.json({ dates: dates31('2026-01'), rows: [] }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: [
        `/attendance/register?class_id=${CLASS_ID}&section_id=${SECTION_ID}&month=2026-01`,
      ],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() => expect(screen.getByText('No students in this section.')).toBeTruthy());
  });

  it('shows an error state when the register-matrix request fails', async () => {
    server.use(
      http.get('/api/v1/attendance/sections/:sectionId/register-matrix', () =>
        HttpResponse.json({ message: 'boom' }, { status: 500 }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: [
        `/attendance/register?class_id=${CLASS_ID}&section_id=${SECTION_ID}&month=2026-01`,
      ],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() => expect(screen.getByText('Could not load the register.')).toBeTruthy());
  });
});
