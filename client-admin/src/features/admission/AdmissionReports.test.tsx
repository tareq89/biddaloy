/**
 * [39.4.1] Admission reports screen — component-level (the route is #1200),
 * MSW-backed.
 */
import { REGION_BD_EN, RegionConfigProvider } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithProviders, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../routeTree.gen';

import { AdmissionReports } from './AdmissionReports';

const YEARS = {
  data: [
    { id: 'y-old', name: '2025', is_current: false },
    { id: 'y-now', name: '2026', is_current: true },
  ],
  total: 2,
  page: 1,
  limit: 100,
  totalPages: 1,
};
const CLASSES = { data: [{ id: 'c1', name: 'Six' }], total: 1, page: 1, limit: 100, totalPages: 1 };

const REPORT = {
  counts: { admitted: 3, withdrawn: 1, transferred_out: 2, graduated: 4, readmitted: 5 },
  rows: [
    {
      student_id: null,
      name: 'Nadia Akter',
      registration_number: null,
      class_name: 'Six',
      event_type: 'ADMITTED',
      occurred_on: '2026-01-05',
      reason: null,
      destination: null,
    },
    {
      student_id: 's2',
      name: 'Rahim Uddin',
      registration_number: 'R-102',
      class_name: 'Six',
      event_type: 'TRANSFERRED_OUT',
      occurred_on: '2026-03-01',
      reason: 'Family moved',
      destination: 'Dhaka Model School',
    },
  ],
  truncated: false,
};

let requests: URLSearchParams[] = [];
function useReport(body: object) {
  server.use(
    http.get('/api/v1/admission/reports/lifecycle', ({ request }) => {
      requests.push(new URL(request.url).searchParams);
      return HttpResponse.json(body);
    }),
  );
}

beforeEach(() => {
  requests = [];
  server.use(
    http.get('/api/v1/academic-years', () => HttpResponse.json(YEARS)),
    http.get('/api/v1/classes', () => HttpResponse.json(CLASSES)),
  );
});
afterEach(async () => {
  await cleanupTestState();
});

// Latin numerals pinned: the default region for these renders would print Bangla digits.
const render = () =>
  renderWithProviders(
    <RegionConfigProvider value={REGION_BD_EN}>
      <AdmissionReports />
    </RegionConfigProvider>,
    { tenantId: 'tenant-1', locale: 'en' },
  );

describe('AdmissionReports', () => {
  it('shows the four counts (Left = withdrawn + transferred out) and rows, dash for missing reg. no.', async () => {
    useReport(REPORT);
    render();

    expect(await screen.findByText('Nadia Akter')).toBeTruthy();
    const counts = await screen.findByTestId('lifecycle-counts');
    expect(within(counts).getByText('Left').nextSibling?.textContent).toBe('3');
    // the Left tile says what it adds up
    expect(within(counts).getByText('Withdrawn 1 · Transferred 2')).toBeTruthy();
    expect(within(counts).getByText('Admitted').nextSibling?.textContent).toBe('3');
    expect(within(counts).getByText('Graduated').nextSibling?.textContent).toBe('4');
    expect(within(counts).getByText('Readmitted').nextSibling?.textContent).toBe('5');
    expect(await screen.findByText('Nadia Akter')).toBeTruthy();
    expect(screen.getByText('R-102')).toBeTruthy();
    expect(screen.getByText('Transferred out')).toBeTruthy();
    // Nadia's row has no reg. no. and no reason: dashes in the table (cards repeat them)
    const nadia = within(screen.getByRole('table')).getByText('Nadia Akter').closest('tr')!;
    expect(within(nadia).getAllByText('—')).toHaveLength(3);
    // defaults to the current year
    expect(requests[0]?.get('academic_year_id')).toBe('y-now');
  });

  it('shows long-form dates, event badges, and the year + class in the subtitle', async () => {
    useReport(REPORT);
    render();
    await screen.findByText('Nadia Akter');
    expect(screen.getByText('5th January, 2026')).toBeTruthy();
    expect(screen.queryByText('2026-01-05')).toBeNull();
    expect(
      document.querySelector('[data-slot="status-badge"][data-tone="neutral"]')?.textContent,
    ).toBe('Transferred out');
    expect(screen.getByText(/Academic year 2026 · All classes/)).toBeTruthy();
    // the year "all" option names the year
    expect(screen.getByRole('combobox', { name: 'Academic year' }).textContent).toContain(
      'Current year (2026)',
    );
  });

  it('links to the student only for rows that have one', async () => {
    useReport(REPORT);
    renderWithRouter(routeTree, {
      initialEntries: ['/admissions/reports'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    await screen.findByText('Nadia Akter');
    const links = await screen.findAllByRole('link', { name: 'View student' });
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute('href')).toBe('/students/s2');
  });

  it('pages 25 rows at a time over the loaded rows, with a total', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      ...REPORT.rows[1]!,
      student_id: `s${i}`,
      name: `Student ${i}`,
    }));
    useReport({ ...REPORT, rows: many });
    render();
    await screen.findByText('Student 0');
    expect(screen.queryByText('Student 25')).toBeNull();
    expect(screen.getByText(/Showing 1–25 of 30/)).toBeTruthy();
  });

  it('refetches with class_id when the class filter changes', async () => {
    useReport(REPORT);
    render();
    await screen.findByText('Nadia Akter');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('combobox', { name: 'Class' }));
    await user.click(await screen.findByRole('option', { name: 'Six' }));
    await waitFor(() => expect(requests.at(-1)?.get('class_id')).toBe('c1'));
  });

  it('shows the empty state', async () => {
    useReport({ ...REPORT, rows: [], counts: { ...REPORT.counts, admitted: 0 } });
    render();
    expect(await screen.findByText('No records for this year')).toBeTruthy();
    expect(screen.getByText(/Admissions, leavers and graduations recorded/)).toBeTruthy();
    expect(screen.queryByText(/Showing/)).toBeNull();
  });

  it('shows the truncated notice', async () => {
    useReport({ ...REPORT, truncated: true });
    render();
    expect(await screen.findByText(/Showing the first 500 records only/)).toBeTruthy();
  });

  it('is axe clean', async () => {
    useReport(REPORT);
    const { container } = render();
    await screen.findByText('Nadia Akter');
    await expect(container).toHaveNoViolations();
  });
});
