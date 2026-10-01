import '@biddaloy/ui/test';

import { RegionConfigProvider } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { PerformanceTab } from './performance-tab';

const full = {
  passRate: 88,
  averageMarks: 71.4,
  attendancePercent: 93,
  homework: { totalAssignments: 4, completed: 3, defaulters: 1, completionPercent: 75 },
  exams: [{ examName: 'Midterm', passRate: 80 }],
};
const empty = {
  passRate: null,
  averageMarks: null,
  attendancePercent: null,
  homework: { totalAssignments: 0, completed: 0, defaulters: 0, completionPercent: null },
  exams: [],
};

function renderTab() {
  server.use(http.get('/api/v1/classes/:id/sections', () => HttpResponse.json([])));
  return renderWithProviders(
    <RegionConfigProvider>
      <PerformanceTab classId="class-1" academicYearId="year-1" />
    </RegionConfigProvider>,
    { locale: 'en', role: 'ADMIN', tenantId: 'tenant-1' },
  );
}

describe('class PerformanceTab', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders widgets with data', async () => {
    server.use(http.get('/api/v1/performance/classes/:id', () => HttpResponse.json(full)));
    renderTab();
    expect(await screen.findByText('Midterm')).toBeTruthy();
    expect(screen.getAllByText('88%').length).toBeGreaterThan(0);
    expect(screen.getAllByText('75%').length).toBeGreaterThan(0);
  });

  it('shows empty states when there is no data', async () => {
    server.use(http.get('/api/v1/performance/classes/:id', () => HttpResponse.json(empty)));
    renderTab();
    expect((await screen.findAllByText('Not enough data yet')).length).toBeGreaterThan(0);
  });

  it('shows an error state on failure', async () => {
    server.use(
      http.get('/api/v1/performance/classes/:id', () => HttpResponse.json({}, { status: 500 })),
    );
    renderTab();
    expect(await screen.findByRole('button', { name: 'Retry' }, { timeout: 8000 })).toBeTruthy();
  });
});
