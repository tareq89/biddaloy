/**
 * [39.4.1] Admission reports screen — component-level (the route is #1200),
 * MSW-backed.
 */
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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

const render = () =>
  renderWithProviders(<AdmissionReports />, { tenantId: 'tenant-1', locale: 'en' });

describe('AdmissionReports', () => {
  it('shows the four counts (Left = withdrawn + transferred out) and rows, dash for missing reg. no.', async () => {
    useReport(REPORT);
    render();

    const counts = await screen.findByTestId('lifecycle-counts');
    expect(within(counts).getByText('Left').nextSibling?.textContent).toBe('3');
    expect(within(counts).getByText('Admitted').nextSibling?.textContent).toBe('3');
    expect(within(counts).getByText('Graduated').nextSibling?.textContent).toBe('4');
    expect(within(counts).getByText('Readmitted').nextSibling?.textContent).toBe('5');
    expect(await screen.findByText('Nadia Akter')).toBeTruthy();
    expect(screen.getByText('R-102')).toBeTruthy();
    expect(screen.getByText('Transferred out')).toBeTruthy();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    // defaults to the current year
    expect(requests[0]?.get('academic_year_id')).toBe('y-now');
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
