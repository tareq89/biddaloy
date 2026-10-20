import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { summaryExpiring, summaryFree } from './billing-fixtures';
import { SeatsBillingSectionView } from './SeatsBillingSectionView';

const opts = { locale: 'en', role: 'ADMIN', tenantId: 'school-1' } as const;
const noop = () => undefined;

afterEach(async () => {
  await cleanupTestState();
});

describe('SeatsBillingSectionView', () => {
  it('during the free period shows the free-until tile and the order', async () => {
    renderWithProviders(
      <SeatsBillingSectionView
        summary={summaryFree}
        loading={false}
        now={new Date('2026-10-20T00:00:00Z')}
        onBuy={noop}
        onRetry={noop}
      />,
      opts,
    );
    expect(await screen.findByText('Free until')).toBeTruthy();
    expect(screen.getByText(/Billing starts on/)).toBeTruthy();
    expect(screen.getByText('Waiting for payment')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Buy seats' })).toBeTruthy();
  });

  it('on the bKash return page, says the order is still being confirmed', async () => {
    renderWithProviders(
      <SeatsBillingSectionView
        summary={summaryFree}
        loading={false}
        returnOrderId={summaryFree.orders[0]!.id}
        onBuy={noop}
        onRetry={noop}
      />,
      opts,
    );
    expect(await screen.findByText(/confirming your payment with bKash/)).toBeTruthy();
  });

  it('after a cancelled bKash return, says the order was not paid and stops saying "confirming"', async () => {
    renderWithProviders(
      <SeatsBillingSectionView
        summary={summaryFree}
        loading={false}
        returnOrderId={summaryFree.orders[0]!.id}
        payment="cancel"
        onBuy={noop}
        onRetry={noop}
      />,
      opts,
    );
    expect(await screen.findByText(/was not paid/)).toBeTruthy();
    expect(screen.queryByText(/confirming your payment/)).toBeNull();
  });

  it('warns when paid seats end soon', async () => {
    renderWithProviders(
      <SeatsBillingSectionView
        summary={summaryExpiring}
        loading={false}
        now={new Date('2027-03-01T00:00:00Z')}
        onBuy={noop}
        onRetry={noop}
      />,
      opts,
    );
    expect(await screen.findByText(/Your seats end on/)).toBeTruthy();
  });

  it('shows a retry on error', async () => {
    renderWithProviders(
      <SeatsBillingSectionView loading={false} error onBuy={noop} onRetry={noop} />,
      opts,
    );
    expect(await screen.findByText(/Couldn't load your seats/)).toBeTruthy();
  });
});
