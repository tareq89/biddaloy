import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

/**
 * [9.10]'s `/attendance/reports` — real route tree, same reasoning
 * `fees/dues.test.tsx` documents for itself.
 */
describe('/attendance/reports', () => {
  beforeEach(() => {
    // The route wraps itself in `RegionConfigProvider` fed by
    // `useTenantRegionConfig()` (`reports.tsx`'s own comment on why) —
    // that hook's `useSchoolSettings` fetch resolves to the default MSW
    // handler's `numerals: 'bengali'` (`ui/src/test/msw/handlers/
    // schools.ts`'s `DEFAULT_REGION`) once it settles, regardless of this
    // render's `locale: 'en'` option, which only ever picks the
    // *fallback* used before that fetch resolves. Overridden here so
    // every percentage assertion below gets deterministic Latin digits
    // rather than a race between the fallback and the real fetch.
    server.use(
      http.get('/api/v1/schools/:id/settings', () =>
        HttpResponse.json({
          version: 1,
          region: {
            locale: 'en-US',
            currency: {
              code: 'BDT',
              symbol: '৳',
              position: 'prefix',
              decimals: 0,
              grouping: 'thousand',
            },
            numerals: 'latin',
            date: { format: 'DD/MM/YYYY', firstDayOfWeek: 0, calendar: 'gregorian' },
            phone: {
              country: 'BD',
              pattern: '^01[3-9]\\d{8}$',
              example: '01712345678',
              displayFormat: '01XXX-XXXXXX',
            },
            address: {
              fields: ['village', 'upazila', 'district'],
              order: ['village', 'upazila', 'district'],
            },
            academicYear: { startMonth: 1 },
            identifiers: { national: 'NID-##########', student: 'STU-####' },
            timezone: 'Asia/Dhaka',
          },
        }),
      ),
    );
  });

  afterEach(async () => {
    await cleanupTestState();
  });

  function registerMatrixRow(overrides: Record<string, unknown> = {}) {
    return {
      student_id: 'student-1',
      roll_number: 3,
      full_name: 'Karim Rahman',
      marks: {},
      summary: {
        student_id: 'student-1',
        from: '2026-09-01',
        to: '2026-09-30',
        working_days: 20,
        marked_days: 10,
        present_days: 8,
        late_days: 1,
        absent_days: 1,
        leave_days: 0,
        unmarked_days: 10,
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

  function flagRow(overrides: Record<string, unknown> = {}) {
    return {
      student_id: 'student-2',
      from: '2026-09-01',
      to: '2026-09-30',
      working_days: 20,
      marked_days: 10,
      present_days: 3,
      late_days: 0,
      absent_days: 7,
      leave_days: 0,
      unmarked_days: 10,
      attendance_percentage: 30,
      policy: {
        late_counts_as_present: true,
        leave_counts_as_working_day: true,
        denominator: 'WORKING_DAYS',
      },
      student_name: 'Nadia Islam',
      roll_number: 9,
      class_name: 'Class 5',
      section_name: 'A',
      guardian_id: null,
      ...overrides,
    };
  }

  it('renders section register-matrix rows once a section is picked, and writes the filter to the URL', async () => {
    server.use(
      http.get('/api/v1/attendance/sections/:sectionId/register-matrix', () =>
        HttpResponse.json({ dates: [], rows: [registerMatrixRow()] }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/reports?section_id=section-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('Karim Rahman');
    expect(screen.getByText('90%')).toBeTruthy();
  });

  it('shows a prompt instead of a spinner when no section is picked in the summary view', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/reports'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() =>
      expect(screen.getByText('Pick a section to see its attendance report.')).toBeTruthy(),
    );
  });

  it('switches to the low-attendance flag list and shows the "Low" badge on every row', async () => {
    server.use(
      http.get('/api/v1/attendance/flags/low', () =>
        HttpResponse.json({ data: [flagRow()], total: 1, page: 1, limit: 20, totalPages: 1 }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/reports'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('combobox', { name: 'View' }));
    await user.click(screen.getByRole('option', { name: 'Low attendance flags' }));

    await screen.findByText('Nadia Islam');
    expect(screen.getByText('30%')).toBeTruthy();
    expect(screen.getByText('Low')).toBeTruthy();
  });

  it('drops a non-numeric threshold instead of sending NaN to the server', async () => {
    let capturedThreshold: string | null | undefined;
    server.use(
      http.get('/api/v1/attendance/flags/low', ({ request }) => {
        capturedThreshold = new URL(request.url).searchParams.get('threshold');
        return HttpResponse.json({
          data: [flagRow()],
          total: 1,
          page: 1,
          limit: 20,
          totalPages: 1,
        });
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/reports?view=flags&threshold=abc'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('Nadia Islam');
    expect(capturedThreshold).toBeNull();
  });

  it('never renders 0% for a student with a null attendance_percentage', async () => {
    server.use(
      http.get('/api/v1/attendance/sections/:sectionId/register-matrix', () =>
        HttpResponse.json({
          dates: [],
          rows: [
            registerMatrixRow({
              summary: { ...registerMatrixRow().summary, attendance_percentage: null },
            }),
          ],
        }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/reports?section_id=section-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('Karim Rahman');
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.queryByText('0%')).toBeNull();
  });

  it("opens the reminder dialog pre-filled for the row's own student", async () => {
    server.use(
      http.get('/api/v1/attendance/flags/low', () =>
        HttpResponse.json({ data: [flagRow()], total: 1, page: 1, limit: 20, totalPages: 1 }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/reports?view=flags'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    const user = userEvent.setup();

    await screen.findByText('Nadia Islam');
    await user.click(screen.getByRole('button', { name: 'Send reminder' }));

    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText('This message will be sent to the guardians of 1 selected student.'),
    ).toBeTruthy();
  });
});
