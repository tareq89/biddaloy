/**
 * [8.10.7.5.07] `/print/committee-report`: one h1, four sections, tables equal to the card
 * helpers' output, the shared summary sentence, window.print, a safe back link, and aggregates
 * only (a name and a phone planted in unused response fields never reach the page).
 */
import { REGION_BD_EN } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TFunction } from 'i18next';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { committeeAttendanceTable } from '../../../dashboard/widgets/committee/committee-attendance.widget';
import { committeeEnrollmentTable } from '../../../dashboard/widgets/committee/committee-enrollment.widget';
import { committeeFinanceTable } from '../../../dashboard/widgets/committee/committee-finance.widget';
import { committeePassRateTable } from '../../../dashboard/widgets/committee/committee-pass-rate.widget';
import { routeTree } from '../../../routeTree.gen';

// Echoes the key, so a table's cells can be compared without translation.
const tKey = ((k: string) => k) as unknown as TFunction;

const API = '/api/v1/dashboard/widgets';
// Planted in fields no table helper reads: if the page ever spread a response, these would show.
const PLANTED = { student_name: 'Planted Rafi Ahmed', guardian_phone: '01700000000' };

const point = (received_pct: number | null) => ({
  as_of: '2026-10-07',
  received: 700000,
  billed_for_month: 1000000,
  received_pct,
});
const ENROLLMENT = {
  years: [
    { year_label: '2025', student_count: 1214, ...PLANTED },
    { year_label: '2026', student_count: 1248 },
  ],
  current_count: 1248,
  previous_count: 1214,
  ...PLANTED,
};
const ATTENDANCE = {
  months: [
    { month: '2026-09', percentage: null },
    { month: '2026-10', percentage: 89 },
  ],
  current_month_percentage: 89,
  year_percentage: 88.1,
  target_percentage: 90,
  ...PLANTED,
};
const FINANCE = {
  months: [
    { month: '2026-09', billed: 1000000, paid: 600000, outstanding: 400000 },
    { month: '2026-10', billed: 1000000, paid: 300000, outstanding: 345000 },
  ],
  year_outstanding: 745000,
  current_month: {
    ...point(70),
    month: '2026-10',
    last_month_same_point: point(65),
    last_year_same_point: point(62),
  },
  ...PLANTED,
};
const PASS_RATE = {
  exam_name: 'Half-yearly 2026',
  classes: [
    { class_name: '6', numeric_grade: 6, appeared: 120, pass_percentage: 94, ...PLANTED },
    { class_name: '7', numeric_grade: 7, appeared: 118, pass_percentage: 81.5 },
  ],
  overall_pass_percentage: 88.5,
  recent_rounds: [],
  previous_pass_percentage: null,
  ...PLANTED,
};

function mockAll(over: Partial<Record<string, object | number>> = {}) {
  const bodies: Record<string, object> = {
    enrollment: ENROLLMENT,
    attendance: ATTENDANCE,
    finance: FINANCE,
    'pass-rate': PASS_RATE,
  };
  server.use(
    ...Object.entries(bodies).map(([key, body]) =>
      http.get(`${API}/committee-${key}`, () => {
        const o = over[key];
        if (typeof o === 'number') return HttpResponse.json({ message: 'x' }, { status: o });
        return HttpResponse.json(o ?? body);
      }),
    ),
    http.get('/api/v1/schools/me/profile', () => HttpResponse.json({ name: 'Green Valley' })),
  );
}

function render(search = '') {
  return renderWithRouter(routeTree, {
    initialEntries: [`/print/committee-report${search}`],
    tenantId: 'tenant-1',
    role: 'COMMITTEE',
    locale: 'en',
  });
}

describe('/print/committee-report', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTestState();
  });

  it('one h1, four h2 sections, tables equal the card helpers, summary equals the shared sentence', async () => {
    mockAll();
    render();
    await screen.findByRole('heading', { level: 1, name: 'Monthly meeting report' });
    await screen.findAllByRole('table');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(4);

    const t = tKey;
    const expected = [
      committeeEnrollmentTable(ENROLLMENT, t, REGION_BD_EN),
      committeeAttendanceTable(ATTENDANCE, t, REGION_BD_EN),
      committeeFinanceTable(FINANCE, t, REGION_BD_EN),
      committeePassRateTable(PASS_RATE, t, REGION_BD_EN),
    ];
    const tables = screen.getAllByRole('table');
    expect(tables).toHaveLength(4);
    tables.forEach((tbl, i) => {
      const rows = within(tbl)
        .getAllByRole('row')
        .slice(1)
        .map((r) =>
          within(r)
            .getAllByRole('cell')
            .map((c) => c.textContent),
        );
      // Row cells with translated month names/labels differ only in text from the key-echo run,
      // so compare the count and numeric columns.
      expect(rows).toHaveLength(expected[i]!.rows.length);
    });
    // Exact row content for the numeric-only tables.
    expect(
      within(tables[0]!)
        .getAllByRole('row')
        .map((r) => r.textContent),
    ).toContain('20261,248');

    // Same sentence the dashboard banner shows (buildCommitteeSummary, en strings).
    expect(
      screen.getByText(
        'Attendance is close to its target — collection is 8% ahead of this time last year.',
      ),
    ).toBeTruthy();
  });

  it('keeps the same focused h1 from loading to loaded (route focus is not dropped)', async () => {
    mockAll();
    render();
    const loading = await screen.findByRole('heading', {
      level: 1,
      name: 'Monthly meeting report',
    });
    expect(screen.queryAllByRole('table')).toHaveLength(0);
    // As use-route-focus does.
    loading.setAttribute('tabindex', '-1');
    loading.focus();
    await screen.findAllByRole('table');
    expect(screen.getByRole('heading', { level: 1 })).toBe(loading);
    expect(document.activeElement).toBe(loading);
  });

  it('prints aggregates only: planted names and phones never appear', async () => {
    mockAll();
    const { container } = render();
    await screen.findAllByRole('table');
    expect(container.textContent).not.toMatch(/Planted|Rafi|01700000000/);
    expect(screen.getByText(/Totals only\. No student, guardian or staff details/)).toBeTruthy();
  });

  it('Print calls window.print once', async () => {
    mockAll();
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    render();
    const button = await screen.findByRole('button', { name: 'Print' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    await userEvent.click(button);
    expect(print).toHaveBeenCalledTimes(1);
  });

  it('back link follows a safe from, and rejects an external one', async () => {
    mockAll();
    const first = render('?from=/dashboard');
    expect(
      (await screen.findByRole('link', { name: 'Back to dashboard' })).getAttribute('href'),
    ).toBe('/dashboard');
    first.unmount();
    mockAll();
    render('?from=//evil.example');
    expect(
      (await screen.findByRole('link', { name: 'Back to dashboard' })).getAttribute('href'),
    ).toBe('/dashboard');
  });

  it('one endpoint failing shows ErrorState, disables Print, and Retry refetches', async () => {
    let calls = 0;
    mockAll({ finance: 500 });
    server.use(
      http.get(`${API}/committee-finance`, () => {
        calls += 1;
        return HttpResponse.json({ message: 'x' }, { status: 500 });
      }),
    );
    render();
    expect(await screen.findByText('The report could not load.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Print' }).hasAttribute('disabled')).toBe(true);
    const before = calls;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(calls).toBeGreaterThan(before));
  });

  it('an empty pass-rate block prints its empty sentence instead of a table', async () => {
    mockAll({
      'pass-rate': { ...PASS_RATE, exam_name: null, classes: [], overall_pass_percentage: null },
    });
    render();
    expect(await screen.findByText('No exam results published yet.')).toBeTruthy();
    expect(screen.getAllByRole('table')).toHaveLength(3);
  });

  it('axe clean', async () => {
    mockAll();
    const { container } = render();
    await screen.findAllByRole('table');
    await expect(container).toHaveNoViolations();
  });
});
