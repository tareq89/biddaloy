import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AuditTable, humanizeAction } from './-audit-table';

const ROW = {
  id: 'a1',
  action: 'UPDATE',
  entityType: 'FeeHead',
  schoolName: 'Rose Valley School',
  tenantId: 't1',
  actorName: 'Rahim',
  impersonatedByName: null,
  sessionId: null,
  at: '2029-12-31T00:00:00.000Z',
};

afterEach(async () => {
  await cleanupTestState();
});

const props = { loading: false, isFetching: false };

describe('AuditTable', () => {
  it('labels a Login as row "Biddaloy support (as Rahim)"', async () => {
    const { localeReady } = renderWithProviders(
      <AuditTable
        {...props}
        rows={[{ ...ROW, impersonatedByName: 'Owner One', sessionId: 's1' }]}
      />,
      { locale: 'en' },
    );
    await localeReady;
    expect(await screen.findAllByText('Biddaloy support (as Rahim)')).not.toHaveLength(0);
  });

  it('shows the plain actor for a normal row and Platform for none', async () => {
    const { localeReady } = renderWithProviders(
      <AuditTable {...props} rows={[ROW, { ...ROW, id: 'a2', actorName: null }]} />,
      { locale: 'en' },
    );
    await localeReady;
    expect((await screen.findAllByText('Rahim')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Platform').length).toBeGreaterThan(0);
  });

  it('says so when empty', async () => {
    const { localeReady } = renderWithProviders(<AuditTable {...props} rows={[]} />, {
      locale: 'en',
    });
    await localeReady;
    expect(await screen.findByText('No activity found')).toBeTruthy();
  });

  it('shows the error sentence', async () => {
    const { localeReady } = renderWithProviders(
      <AuditTable {...props} rows={[]} error="Could not load the audit. Try again." />,
      { locale: 'en' },
    );
    await localeReady;
    expect(await screen.findByText('Could not load the audit. Try again.')).toBeTruthy();
  });

  it('humanizes an action nobody translated', () => {
    expect(humanizeAction('ORDER_PLACED')).toBe('Order placed');
  });
});
