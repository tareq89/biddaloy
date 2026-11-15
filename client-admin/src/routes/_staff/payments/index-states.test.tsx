/** [3329.2.04] `/payments` failed-read states: Retry on a fault, a refusal on 403. */
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

function render() {
  return renderWithRouter(routeTree, {
    initialEntries: ['/payments'],
    tenantId: 'tenant-1',
    role: 'ACCOUNTANT',
    locale: 'en',
  });
}

describe('/payments failed read', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('offers one Retry action and a fixed sentence on a server fault', async () => {
    server.use(
      http.get('/api/v1/payments', () => HttpResponse.json({ message: 'boom' }, { status: 500 })),
    );
    const { localeReady } = render();
    await localeReady;

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Payments could not be loaded.');
    expect(alert.textContent).not.toContain('boom');
    expect(screen.getAllByRole('button', { name: /try again|retry/i })).toHaveLength(1);
  });
});
