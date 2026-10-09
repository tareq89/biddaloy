import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { HrRecordPromotionSection } from './hr-record-promotion-section';

afterEach(async () => {
  await cleanupTestState();
});

describe('HrRecordPromotionSection', () => {
  it('shows an error state, with retry, when the history query fails', async () => {
    server.use(
      http.get('/api/v1/staff-hr-records/user-1/designation-history', () =>
        HttpResponse.json({ message: 'boom' }, { status: 500 }),
      ),
    );
    server.use(http.get('/api/v1/designations', () => HttpResponse.json([])));

    const { localeReady } = renderWithProviders(<HrRecordPromotionSection userId="user-1" />, {
      locale: 'en',
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });
    await localeReady;

    expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByText('No promotions recorded yet')).toBeNull();

    server.use(
      http.get('/api/v1/staff-hr-records/user-1/designation-history', () => HttpResponse.json([])),
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('No promotions recorded yet')).toBeTruthy();
  });

  it('marks the open row with a Current badge and puts the outline Promote button after the list', async () => {
    server.use(
      http.get('/api/v1/staff-hr-records/user-1/designation-history', () =>
        HttpResponse.json([
          {
            id: 'h-1',
            designation_id: 'des-1',
            effective_date: '2024-01-01',
            end_date: null,
          },
        ]),
      ),
      http.get('/api/v1/designations', () => HttpResponse.json([])),
    );

    const { localeReady } = renderWithProviders(<HrRecordPromotionSection userId="user-1" />, {
      locale: 'en',
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });
    await localeReady;

    expect(await screen.findByText('Current')).toBeTruthy();
    const list = screen.getByRole('list');
    const promote = screen.getByRole('button', { name: 'Promote' });
    expect(list.compareDocumentPosition(promote) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(promote.className).not.toContain('bg-primary');
  });
});
