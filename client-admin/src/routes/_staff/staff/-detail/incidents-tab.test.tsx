import { cleanupTestState, incidentFactory, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { IncidentsTab } from './incidents-tab';

afterEach(async () => {
  await cleanupTestState();
});

describe('IncidentsTab', () => {
  it('lists incidents and offers Report to ACR_WRITE', async () => {
    server.use(
      http.get('/api/v1/incidents', () =>
        HttpResponse.json([
          incidentFactory({ id: 'i1', description: 'Late to assembly', severity: 'HIGH' }),
        ]),
      ),
    );
    renderWithProviders(<IncidentsTab userId="user-1" />, {
      locale: 'en',
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });
    expect(await screen.findByText('Late to assembly')).toBeTruthy();
    expect(screen.getByText('High')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Report an incident' })).toBeTruthy();
  });

  it('shows the empty state and hides Report without ACR_WRITE', async () => {
    server.use(http.get('/api/v1/incidents', () => HttpResponse.json([])));
    renderWithProviders(<IncidentsTab userId="user-1" />, {
      locale: 'en',
      tenantId: 'tenant-1',
      role: 'TEACHER',
    });
    expect(await screen.findByText(/no incidents/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Report an incident' })).toBeNull();
  });
});
