import '@biddaloy/ui/test';

import { RegionConfigProvider } from '@biddaloy/ui/i18n';
import {
  cleanupTestState,
  renderWithProviders,
  renderWithRouter,
  server,
  userResponseFactory,
} from '@biddaloy/ui/test';
import { fireEvent, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

import { PerformanceTab } from './performance-tab';

const USER_ID = 'user-1';
const homework = { totalAssignments: 10, completed: 8, defaulters: 2, completionPercent: 80 };
const klass = {
  classId: 'class-1',
  sectionId: 'sec-1',
  academicYearId: 'year-1',
  termId: null,
  from: '2026-01-01',
  to: '2026-12-31',
  passRate: 90,
  averageMarks: 72.5,
  attendancePercent: 95,
  homework,
  exams: [],
};
const base = {
  userId: USER_ID,
  acr: [{ academicYearId: 'year-1', status: 'COMPLETED', total: 85 }],
  survey: { averageStars: 4.5, surveyCount: 1 },
  incidentCount: 3,
  classes: [klass],
};

function years() {
  server.use(
    http.get('/api/v1/academic-years', () =>
      HttpResponse.json({
        data: [{ id: 'year-1', name: '2026', is_current: true }],
        total: 1,
        page: 1,
        limit: 100,
      }),
    ),
  );
}

function renderTab() {
  return renderWithProviders(
    <RegionConfigProvider>
      <PerformanceTab userId={USER_ID} subjectName="Mr. Karim" />
    </RegionConfigProvider>,
    { locale: 'en', role: 'ADMIN', tenantId: 'tenant-1' },
  );
}

describe('staff PerformanceTab', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders widgets with data', async () => {
    years();
    server.use(http.get('/api/v1/performance/staff/:id', () => HttpResponse.json(base)));
    renderTab();

    expect(await screen.findByText('2026 (Completed)')).toBeTruthy();
    expect(screen.getByText('4.5 / 5')).toBeTruthy();
    expect(screen.getAllByText('90%').length).toBeGreaterThan(0);
    expect(screen.getByText('3')).toBeTruthy();
    expect(
      document.querySelector('#performance-print-area h2.performance-print-title')?.textContent,
    ).toBe('Performance report — Mr. Karim');
  });

  it('prints the on-screen content via window.print', async () => {
    years();
    server.use(http.get('/api/v1/performance/staff/:id', () => HttpResponse.json(base)));
    renderTab();
    expect(screen.queryByRole('button', { name: 'Print / Save as PDF' })).toBeNull();
    await screen.findByText('2026 (Completed)');
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const button = screen.getByRole('button', { name: 'Print / Save as PDF' });
    expect(button.parentElement?.className).toContain('print:hidden');
    expect(button.closest('#performance-print-area')).not.toBeNull();
    fireEvent.click(button);
    expect(print).toHaveBeenCalledTimes(1);
    print.mockRestore();
    expect(screen.getByText('4.5 / 5')).toBeTruthy();
  });

  it('shows the waiting message when the survey is sealed', async () => {
    years();
    server.use(
      http.get('/api/v1/performance/staff/:id', () =>
        HttpResponse.json({ ...base, survey: { averageStars: null, surveyCount: 1 } }),
      ),
    );
    renderTab();

    expect(await screen.findByText('Waiting for more responses')).toBeTruthy();
    expect(screen.queryByText('4.5 / 5')).toBeNull();
    // Sealed: nothing survey-shaped (no "x / 5", no 0) inside the printed area.
    const area = document.getElementById('performance-print-area');
    expect(area?.textContent).toContain('Waiting for more responses');
    expect(area?.textContent).not.toMatch(/\/ 5/);
  });

  it('shows "Not enough data yet" per widget on 404', async () => {
    years();
    server.use(
      http.get('/api/v1/performance/staff/:id', () =>
        HttpResponse.json(
          {
            statusCode: 404,
            message: 'nope',
            timestamp: '2026-01-01T00:00:00Z',
            path: '/',
            requestId: 'r1',
          },
          { status: 404 },
        ),
      ),
    );
    renderTab();

    // summary card + acr, passRate, marks, attendance, homework widgets
    expect((await screen.findAllByText('Not enough data yet')).length).toBe(6);
    expect(screen.getByText('Waiting for more responses')).toBeTruthy();
  });

  it('shows an error state with retry on 500', async () => {
    years();
    server.use(
      http.get('/api/v1/performance/staff/:id', () =>
        HttpResponse.json({ message: 'boom' }, { status: 500 }),
      ),
    );
    renderTab();

    expect(
      await screen.findByText("Couldn't load performance.", {}, { timeout: 4000 }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Print / Save as PDF' })).toBeNull();
  });
});

describe('staff detail Performance tab visibility', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  // The "hidden without ACR_READ" case lives in `$userId.acr-gate.test.tsx`
  // (no real role can open staff detail without ACR_READ, so it mocks the
  // permission); here we only prove ACR_READ holders get the tab.
  it('ADMIN sees the tab', async () => {
    const user = userResponseFactory({ id: USER_ID, role: 'TEACHER' });
    server.use(
      http.get('/api/v1/users/:id', () => HttpResponse.json(user)),
      http.get('/api/v1/teachers', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 1, totalPages: 0 }),
      ),
    );
    renderWithRouter(routeTree, {
      initialEntries: [`/staff/${USER_ID}`],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('tab', { name: 'Profile' });
    expect(screen.queryByRole('tab', { name: 'Performance' }) !== null).toBe(true);
  });
});
