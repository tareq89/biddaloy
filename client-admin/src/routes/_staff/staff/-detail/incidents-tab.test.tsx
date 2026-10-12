import { cleanupTestState, incidentFactory, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  it('the Withdraw action needs a reason and calls the API', async () => {
    let posted: { id: string; body: unknown } | undefined;
    server.use(
      http.get('/api/v1/incidents', () =>
        HttpResponse.json([incidentFactory({ id: 'i1', description: 'Wrong person' })]),
      ),
      http.post('/api/v1/incidents/:id/withdraw', async ({ params, request }) => {
        posted = { id: String(params.id), body: await request.json() };
        return HttpResponse.json(incidentFactory({ id: 'i1' }));
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<IncidentsTab userId="user-1" />, {
      locale: 'en',
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });
    await user.click(await screen.findByRole('button', { name: 'Withdraw' }));

    // Empty reason: blocked client-side, nothing sent.
    await user.click(screen.getByRole('button', { name: 'Withdraw incident' }));
    expect(await screen.findByText('Give a reason.')).toBeTruthy();
    expect(posted).toBeUndefined();

    await user.type(screen.getByLabelText('Why is it being withdrawn?'), 'Wrong staff member');
    await user.click(screen.getByRole('button', { name: 'Withdraw incident' }));
    await waitFor(() =>
      expect(posted).toEqual({ id: 'i1', body: { reason: 'Wrong staff member' } }),
    );
  });

  it('no Withdraw action without ACR_WRITE', async () => {
    server.use(
      http.get('/api/v1/incidents', () => HttpResponse.json([incidentFactory({ id: 'i1' })])),
    );
    renderWithProviders(<IncidentsTab userId="user-1" />, {
      locale: 'en',
      tenantId: 'tenant-1',
      role: 'TEACHER',
    });
    await screen.findByText('Late to assembly');
    expect(screen.queryByRole('button', { name: 'Withdraw' })).toBeNull();
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
