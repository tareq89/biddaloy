import '@biddaloy/ui/test';

import { RegionConfigProvider } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { HomeworkTab } from './homework-tab';

const CLASS_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

function renderTab(classId: string) {
  return renderWithProviders(
    <RegionConfigProvider>
      <HomeworkTab classId={classId} />
    </RegionConfigProvider>,
    { locale: 'en', role: 'ADMIN', tenantId: 'tenant-1' },
  );
}

function mockRollup(overrides: Partial<Record<string, unknown>> = {}) {
  server.use(
    http.get('/api/v1/homework/analytics/class/:classId', () =>
      HttpResponse.json({
        totalAssignments: 20,
        completed: 15,
        defaulters: 2,
        completionPercent: 75,
        syllabus: { totalTopics: 8, done: 5, completionPercent: 62 },
        ...overrides,
      }),
    ),
  );
}

describe('HomeworkTab (class detail)', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders the completion and syllabus rollups once loaded', async () => {
    mockRollup();

    renderTab(CLASS_ID);

    await waitFor(() => expect(screen.getByText('75%')).toBeTruthy());
    expect(screen.getByText('62%')).toBeTruthy();
    expect(screen.getByText('5 of 8 topics done')).toBeTruthy();
  });

  it('shows the empty state when there is no homework or syllabus data', async () => {
    mockRollup({
      totalAssignments: 0,
      completed: 0,
      defaulters: 0,
      completionPercent: 0,
      syllabus: { totalTopics: 0, done: 0, completionPercent: 0 },
    });

    renderTab(CLASS_ID);

    await waitFor(() =>
      expect(screen.getByText('No homework or syllabus data yet.')).toBeTruthy(),
    );
  });

  it('shows an error state with retry when the rollup fails to load', async () => {
    server.use(
      http.get('/api/v1/homework/analytics/class/:classId', () =>
        HttpResponse.json({ message: 'boom' }, { status: 500 }),
      ),
    );

    renderTab(CLASS_ID);

    await waitFor(() => expect(screen.getByText("Couldn't load homework.")).toBeTruthy());
  });
});
