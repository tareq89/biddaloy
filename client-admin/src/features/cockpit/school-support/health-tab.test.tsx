import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { HealthTab } from './health-tab';

const engine = {
  lastSweep: { FAST: new Date().toISOString(), HOURLY: null, DAILY: null },
  durationsMs: { FAST: 1200, HOURLY: null, DAILY: null },
  failingRules: [],
};
const view = () =>
  renderWithProviders(<HealthTab schoolId="s-1" />, {
    locale: 'en',
    role: 'SUPER_ADMIN',
    tenantId: 'platform',
  });
const serve = (alerts: { severity: string; count: number }[]) =>
  server.use(
    http.get('*/platform/backups/health', () =>
      HttpResponse.json({
        data: [
          {
            school_id: 's-1',
            name: 'Rose Valley',
            schedule: 'DAILY',
            last_success_at: null,
            last_status: null,
            storage_total_bytes: '2048',
          },
          {
            school_id: 's-2',
            name: 'Other School',
            schedule: 'OFF',
            last_success_at: null,
            last_status: null,
            storage_total_bytes: '0',
          },
        ],
      }),
    ),
    http.get('*/platform/attention/health', () => HttpResponse.json(engine)),
    http.get('*/platform/schools/:id/overview', () =>
      HttpResponse.json({ schoolId: 's-1', openAlerts: alerts }),
    ),
  );

afterEach(async () => {
  await cleanupTestState();
});

describe('HealthTab', () => {
  it('renders the backup row of this school, the engine card and the alerts', async () => {
    serve([{ severity: 'critical', count: 2 }]);
    const { container } = view();
    expect(await screen.findByText('Rose Valley')).toBeTruthy();
    expect(screen.queryByText('Other School')).toBeNull();
    expect(await screen.findByText('Running')).toBeTruthy();
    expect(await screen.findByText(/(Critical|জরুরি): (2|২)/)).toBeTruthy();
    await expect(container).toHaveNoViolations();
  });

  it('empty alerts', async () => {
    serve([]);
    view();
    expect(await screen.findByText('No open alerts.')).toBeTruthy();
  });

  it('errors are fixed sentences', async () => {
    server.use(
      http.get('*/platform/backups/health', () => HttpResponse.json({}, { status: 500 })),
      http.get('*/platform/attention/health', () => HttpResponse.json({}, { status: 500 })),
      http.get('*/platform/schools/:id/overview', () => HttpResponse.json({}, { status: 500 })),
    );
    view();
    expect(await screen.findAllByText("Could not load the school's health.")).not.toHaveLength(0);
  });
});
