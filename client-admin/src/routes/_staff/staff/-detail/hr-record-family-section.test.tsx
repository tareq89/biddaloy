import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { HrRecordFamilySection } from './hr-record-family-section';

/**
 * Representative of all 7 [23.10] sections — they're identical
 * `RepeatableRowForm` config wrappers over `GET`/`PUT
 * /staff/:userId/<resource>` (only the field list differs, per D3), so
 * one section's save round-trip stands in for the other 6 rather than
 * duplicating this test file six more times.
 */
afterEach(async () => {
  await cleanupTestState();
});

describe('HrRecordFamilySection', () => {
  it('renders the configured field labels for an existing row', async () => {
    server.use(
      http.get('/api/v1/staff/user-1/family', () =>
        HttpResponse.json([{ id: 'row-1', relation: 'Father', name: 'Karim Rahman' }]),
      ),
    );

    renderWithProviders(<HrRecordFamilySection userId="user-1" />, {
      locale: 'en',
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });

    expect(await screen.findByDisplayValue('Father')).toBeTruthy();
    expect(screen.getByDisplayValue('Karim Rahman')).toBeTruthy();
  });

  it('saves to PUT /staff/:userId/family with the full row list', async () => {
    server.use(http.get('/api/v1/staff/user-1/family', () => HttpResponse.json([])));
    let putBody: unknown;
    server.use(
      http.put('/api/v1/staff/user-1/family', async ({ request }) => {
        putBody = await request.json();
        return HttpResponse.json([]);
      }),
    );

    renderWithProviders(<HrRecordFamilySection userId="user-1" />, {
      locale: 'en',
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add row' }));
    await user.type(screen.getByLabelText('Relation *'), 'Mother');
    await user.type(screen.getByLabelText('Name *'), 'Jasmine Begum');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(putBody).toEqual({
        rows: [{ relation: 'Mother', name: 'Jasmine Begum', occupation: '', contact: '' }],
      }),
    );
  });
});
