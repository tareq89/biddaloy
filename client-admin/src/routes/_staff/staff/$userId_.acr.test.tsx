import {
  acrAssessmentFactory,
  cleanupTestState,
  renderWithRouter,
  server,
} from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

afterEach(async () => {
  await cleanupTestState();
});

function render() {
  return renderWithRouter(routeTree, {
    initialEntries: ['/staff/user-1/acr/acr-1'],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
}

describe('ACR page', () => {
  it('renders the form for the matching staff member', async () => {
    server.use(
      http.get('/api/v1/acr/assessments/:id', () =>
        HttpResponse.json(acrAssessmentFactory({ id: 'acr-1', user_id: 'user-1' })),
      ),
    );
    render();
    expect(
      await screen.findByRole('heading', { name: 'Annual Confidential Report' }, { timeout: 5000 }),
    ).toBeTruthy();
  });

  it('shows the load error when the assessment belongs to someone else', async () => {
    server.use(
      http.get('/api/v1/acr/assessments/:id', () =>
        HttpResponse.json(acrAssessmentFactory({ id: 'acr-1', user_id: 'other-user' })),
      ),
    );
    render();
    expect(
      await screen.findByRole('button', { name: /retry|try again/i }, { timeout: 5000 }),
    ).toBeTruthy();
  });

  it('shows the load error when the fetch fails', async () => {
    server.use(
      http.get('/api/v1/acr/assessments/:id', () => HttpResponse.json({}, { status: 500 })),
    );
    render();
    expect(
      await screen.findByRole('button', { name: /retry|try again/i }, { timeout: 8000 }),
    ).toBeTruthy();
  });
});
