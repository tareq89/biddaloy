import {
  acrCriterionFactory,
  cleanupTestState,
  renderWithProviders,
  server,
} from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { AcrCriteriaSection } from './AcrCriteriaSection';

afterEach(async () => {
  await cleanupTestState();
});

describe('AcrCriteriaSection', () => {
  it('shows the applies-to-new-ACRs notice and, after Save, the new version', async () => {
    let putBody: unknown;
    server.use(
      http.get('/api/v1/acr/criteria', () =>
        HttpResponse.json({
          id: 'v1',
          version: 1,
          criteria: [acrCriterionFactory({ id: 'c1', code: 'PUNCTUALITY', sort_order: 1 })],
        }),
      ),
      http.put('/api/v1/acr/criteria', async ({ request }) => {
        putBody = await request.json();
        return HttpResponse.json({ id: 'v2', version: 2, criteria: [] });
      }),
    );
    renderWithProviders(<AcrCriteriaSection />, {
      locale: 'en',
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });

    expect(await screen.findByText(/Changes apply to new ACRs only/)).toBeTruthy();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Add criterion' }));
    await user.click(screen.getByRole('button', { name: 'Save criteria' }));
    // New row is blank -> blocked client-side, nothing sent.
    expect(await screen.findByText('Code and both names are required.')).toBeTruthy();
    expect(putBody).toBeUndefined();

    await user.click(screen.getAllByRole('button', { name: 'Remove' })[1]!);
    await user.click(screen.getByRole('button', { name: 'Save criteria' }));
    await waitFor(() =>
      expect(screen.getByText('Saved as version 2. Applies to new ACRs only.')).toBeTruthy(),
    );
    expect(putBody).toMatchObject({ criteria: [{ code: 'PUNCTUALITY', sort_order: 1 }] });
  });
});
