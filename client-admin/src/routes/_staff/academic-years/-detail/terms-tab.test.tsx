import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { TermsTab } from './terms-tab';

const TERM_1 = {
  id: 'term-1',
  academic_year_id: 'year-1',
  seq: 1,
  name: 'First Term',
  start_date: '2026-01-01',
  end_date: '2026-04-30',
};
const TERM_2 = {
  id: 'term-2',
  academic_year_id: 'year-1',
  seq: 2,
  name: 'Second Term',
  start_date: '2026-05-01',
  end_date: '2026-08-31',
};

const CALENDAR_SETTINGS = {
  termLabel: 'TERM',
  country: 'BD',
  firstDayOfWeek: 0,
  weeklyOffDays: [5],
  timezone: 'Asia/Dhaka',
  currentAcademicYear: null,
};

function mockTerms(terms: unknown[] = [TERM_1, TERM_2]) {
  server.use(
    http.get('/api/v1/calendar/terms', () => HttpResponse.json(terms)),
    http.get('/api/v1/calendar-settings', () => HttpResponse.json(CALENDAR_SETTINGS)),
  );
}

describe('TermsTab', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders every term, ordered by seq, with its length in weeks', async () => {
    mockTerms();

    renderWithProviders(<TermsTab academicYearId="year-1" />, {
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    expect(await screen.findByText('First Term')).toBeTruthy();
    expect(screen.getByText('Second Term')).toBeTruthy();
    // Both terms span roughly four months -> 18 weeks each
    // (2026-01-01..2026-04-30 is 120 days, ceil(120/7) = 18;
    // 2026-05-01..2026-08-31 is 123 days, ceil(123/7) = 18).
    expect(screen.getAllByText('18 weeks')).toHaveLength(2);
  });

  it('shows the empty message when the year has no terms yet', async () => {
    mockTerms([]);

    renderWithProviders(<TermsTab academicYearId="year-1" />, {
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    expect(await screen.findByText('No terms defined for this academic year')).toBeTruthy();
  });

  it('uses the termLabel from calendar settings for the heading and Add button', async () => {
    server.use(
      http.get('/api/v1/calendar/terms', () => HttpResponse.json([TERM_1])),
      http.get('/api/v1/calendar-settings', () =>
        HttpResponse.json({ ...CALENDAR_SETTINGS, termLabel: 'SEMESTER' }),
      ),
    );

    renderWithProviders(<TermsTab academicYearId="year-1" />, {
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    expect(await screen.findByRole('heading', { name: 'Semesters' })).toBeTruthy();
  });

  it('ADMIN (CALENDAR_MANAGE) sees Add term and per-row Edit/Delete', async () => {
    mockTerms();

    renderWithProviders(<TermsTab academicYearId="year-1" />, {
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('First Term');
    expect(screen.getByRole('button', { name: 'Add term' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Edit' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Delete' }).length).toBeGreaterThan(0);
  });

  it('reorder moves the term down and posts the new id order', async () => {
    mockTerms();
    let capturedBody: unknown;
    server.use(
      http.post('/api/v1/calendar/terms/reorder', async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json([
          { ...TERM_1, seq: 2 },
          { ...TERM_2, seq: 1 },
        ]);
      }),
    );

    const { user } = renderWithProviders(<TermsTab academicYearId="year-1" />, {
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('First Term');
    await user.click(screen.getAllByRole('button', { name: 'Move down' })[0]!);

    await waitFor(() =>
      expect(capturedBody).toEqual({ academic_year_id: 'year-1', ids: ['term-2', 'term-1'] }),
    );
  });

  it('maps a 422 TERM_OVERLAP response on the edit dialog instead of a silent failure', async () => {
    mockTerms();
    server.use(
      http.patch('/api/v1/calendar/terms/:id', () =>
        HttpResponse.json(
          {
            statusCode: 422,
            message: '"First Term" overlaps an existing term in this academic year',
            timestamp: new Date().toISOString(),
            path: '/api/v1/calendar/terms/term-1',
            requestId: 'req-1',
            details: { code: 'TERM_OVERLAP' },
          },
          { status: 422 },
        ),
      ),
    );

    const { user } = renderWithProviders(<TermsTab academicYearId="year-1" />, {
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('First Term');
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]!);
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(
        screen.getByText('"First Term" overlaps an existing term in this academic year'),
      ).toBeTruthy(),
    );
  });
});
