import '@biddaloy/ui/test';

import { RegionConfigProvider } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { HomeworkTab } from './homework-tab';

const STUDENT_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

function renderTab(studentId: string) {
  return renderWithProviders(
    <RegionConfigProvider>
      <HomeworkTab studentId={studentId} />
    </RegionConfigProvider>,
    { locale: 'en', role: 'ADMIN', tenantId: 'tenant-1' },
  );
}

function mockRollup(overrides: Partial<Record<string, unknown>> = {}) {
  server.use(
    http.get('/api/v1/homework/analytics/student/:studentId', () =>
      HttpResponse.json({
        totalAssignments: 10,
        completed: 7,
        defaulters: 1,
        completionPercent: 70,
        ...overrides,
      }),
    ),
  );
}

describe('HomeworkTab (student detail)', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders the completion rollup once loaded', async () => {
    mockRollup();

    renderTab(STUDENT_ID);

    await waitFor(() => expect(screen.getByText('70%')).toBeTruthy());
    expect(screen.getByText('10')).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy();
  });

  it('shows the empty state when the student has no assignments', async () => {
    mockRollup({ totalAssignments: 0, completed: 0, defaulters: 0, completionPercent: 0 });

    renderTab(STUDENT_ID);

    await waitFor(() =>
      expect(screen.getByText('No homework assigned yet.')).toBeTruthy(),
    );
  });

  it('shows an error state with retry when the rollup fails to load', async () => {
    server.use(
      http.get('/api/v1/homework/analytics/student/:studentId', () =>
        HttpResponse.json({ message: 'boom' }, { status: 500 }),
      ),
    );

    renderTab(STUDENT_ID);

    await waitFor(() => expect(screen.getByText("Couldn't load homework.")).toBeTruthy());
  });
});
