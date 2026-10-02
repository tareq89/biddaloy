import {
  acrAssessmentFactory,
  cleanupTestState,
  incidentFactory,
  renderWithRouter,
  server,
} from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

/**
 * [28.4.1] Evaluations register against the real route tree (so the
 * `ACR_READ` gate in `_staff.tsx` is the one under test).
 */
function render(role: 'ADMIN' | 'TEACHER', entry = '/staff/evaluations') {
  return renderWithRouter(routeTree, {
    initialEntries: [entry],
    tenantId: 'tenant-1',
    role,
    locale: 'en',
  });
}

afterEach(async () => {
  await cleanupTestState();
});

describe('/staff/evaluations', () => {
  it('ACR tab: status filter is sent to the server and rows link to the ACR', async () => {
    const seen: string[] = [];
    server.use(
      http.get('/api/v1/acr/assessments', ({ request }) => {
        seen.push(new URL(request.url).search);
        return HttpResponse.json([acrAssessmentFactory({ id: 'a1', status: 'COMPLETED' })]);
      }),
    );
    render('ADMIN');
    await screen.findByRole('heading', { name: 'ACR register' });
    await screen.findByRole('link', { name: 'Open' });

    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'Status' }));
    await user.click(await screen.findByRole('option', { name: 'Completed' }));
    await waitFor(() => expect(seen.some((s) => s.includes('status=COMPLETED'))).toBe(true));
  });

  it('ACR tab shows the empty-state text when there are no ACRs', async () => {
    server.use(http.get('/api/v1/acr/assessments', () => HttpResponse.json([])));
    render('ADMIN');
    expect(await screen.findByText('No ACRs yet for this filter.')).toBeTruthy();
  });

  it('Incidents tab: severity filter narrows rows', async () => {
    server.use(
      http.get('/api/v1/incidents', () =>
        HttpResponse.json([
          incidentFactory({ id: 'i1', severity: 'LOW', description: 'Late to assembly' }),
          incidentFactory({ id: 'i2', severity: 'HIGH', description: 'Left class early' }),
        ]),
      ),
    );
    render('ADMIN', '/staff/evaluations?tab=incidents');
    await screen.findByText('Late to assembly');
    expect(screen.getByText('Left class early')).toBeTruthy();

    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'Severity' }));
    await user.click(await screen.findByRole('option', { name: 'High' }));
    await waitFor(() => expect(screen.queryByText('Late to assembly')).toBeNull());
    expect(screen.getByText('Left class early')).toBeTruthy();
  });

  it('Incidents tab shows the empty-state text', async () => {
    server.use(http.get('/api/v1/incidents', () => HttpResponse.json([])));
    render('ADMIN', '/staff/evaluations?tab=incidents');
    expect(await screen.findByText('No incidents reported.')).toBeTruthy();
  });

  it('Surveys tab shows the empty-state text', async () => {
    server.use(http.get('/api/v1/surveys', () => HttpResponse.json([])));
    render('ADMIN', '/staff/evaluations?tab=surveys');
    expect(await screen.findByText('No surveys yet.')).toBeTruthy();
  });

  it('is refused for a role without ACR_READ', async () => {
    render('TEACHER');
    await screen.findByRole('heading', { name: /don't have access to this page/i });
    expect(screen.queryByRole('heading', { name: 'ACR register' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Incidents' })).toBeNull();
  });
});
