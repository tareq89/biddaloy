import '@biddaloy/ui/test';

import type { SmsCreditsResponse } from '@biddaloy/ui/hooks';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import bn from '../../../../ui/src/i18n/locales/bn/smsBundles.json';

import { SmsBundlesPanel, type SmsBundlesPanelProps } from './SmsBundlesPanel';

afterEach(async () => {
  await cleanupTestState();
});

const lot = (id: string, remaining: number, expires_at: string | null) => ({
  id,
  source: 'bundle',
  units_total: 2000,
  remaining,
  expires_at,
});

const credits = (over: Partial<SmsCreditsResponse> = {}): SmsCreditsResponse => ({
  metering: 'PLATFORM',
  available: 0,
  reserved: 0,
  lots: [],
  orders: [],
  source: 'SCHOOLMANAGERP',
  almostFinished: false,
  stopped: false,
  ledger: { data: [], total: 0, page: 1, limit: 25, totalPages: 1 },
  ...over,
});

function setup(props: Partial<SmsBundlesPanelProps> = {}, locale: 'en' | 'bn' = 'en') {
  renderWithProviders(
    <SmsBundlesPanel
      credits={credits()}
      canBuy
      now={new Date('2026-11-14T00:00:00Z')}
      {...props}
    />,
    { locale, role: 'ADMIN', tenantId: 'school-1' },
  );
}

describe('SmsBundlesPanel', () => {
  it('renders one card per package from the server, nothing hard-coded', async () => {
    server.use(
      http.get('/api/v1/sms-bundles/catalog', () =>
        HttpResponse.json([
          {
            id: '00000000-0000-4000-8000-000000000199',
            name: 'Only Pack',
            smsCount: 77,
            validityDays: 30,
            pricePaisa: '12300',
            priceTaka: '123',
            active: true,
          },
        ]),
      ),
    );
    setup();
    expect(await screen.findByText('Only Pack')).toBeTruthy();
    expect(screen.getAllByRole('group')).toHaveLength(1);
  });

  it('opens the buy dialog from a Buy button', async () => {
    setup();
    const card = (await screen.findByText('Medium')).closest('[role="group"]') as HTMLElement;
    await userEvent.click(within(card).getByRole('button', { name: 'Buy' }));
    expect(await screen.findByRole('button', { name: 'Buy with bKash' })).toBeTruthy();
  });

  it('lists the lots soonest first, no-end-date last', async () => {
    setup({
      credits: credits({
        lots: [
          lot('a', 300, null),
          lot('b', 200, '2027-06-01T00:00:00Z'),
          lot('c', 100, '2026-12-01T00:00:00Z'),
        ],
      }),
    });
    const items = await screen.findAllByRole('listitem');
    expect(items[0]!.textContent).toContain('১০০');
    expect(items[1]!.textContent).toContain('২০০');
    expect(items[2]!.textContent).toContain('৩০০');
    expect(items[2]!.textContent).toContain('No end date');
  });

  it('flags a part ending within a week', async () => {
    setup({ credits: credits({ lots: [lot('a', 900, '2026-11-20T00:00:00Z')] }) });
    expect(await screen.findByText('Ends soon')).toBeTruthy();
  });

  it('says so when there is nothing left', async () => {
    setup();
    expect(await screen.findByText('You have no SMS left.')).toBeTruthy();
  });

  it('shows the unmasked note in English and Bangla, never the word masked', async () => {
    setup();
    expect(await screen.findByText(/only sends unmasked SMS/)).toBeTruthy();
    expect(bn.unmaskedNote).toContain('আনমাস্কড SMS');
  });

  it('a school on its own provider sees the packages and the switch before buying', async () => {
    setup({ credits: credits({ source: 'OWN' }) });
    const card = (await screen.findByText('Small')).closest('[role="group"]') as HTMLElement;
    await userEvent.click(within(card).getByRole('button', { name: 'Buy' }));
    expect(await screen.findByRole('button', { name: 'Switch and continue' })).toBeTruthy();
    expect(screen.getByText(/stay saved/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Buy with bKash' })).toBeNull();
  });

  it('after switching, goes on to the buy dialog', async () => {
    setup({ credits: credits({ source: 'OWN' }) });
    const card = (await screen.findByText('Small')).closest('[role="group"]') as HTMLElement;
    await userEvent.click(within(card).getByRole('button', { name: 'Buy' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Switch and continue' }));
    expect(await screen.findByRole('button', { name: 'Buy with bKash' })).toBeTruthy();
  });

  it('shows no packages in a read-only view', async () => {
    setup({ canBuy: false });
    expect(await screen.findByText('You have no SMS left.')).toBeTruthy();
    expect(screen.queryByText('Medium')).toBeNull();
  });

  it('shows the order as paid after the bKash return', async () => {
    const id = '00000000-0000-4000-8000-0000000002aa';
    setup({
      returnOrderId: id,
      credits: credits({
        orders: [
          {
            id,
            name: 'Medium',
            sms_count: 2000,
            price_paisa: 180000,
            status: 'PAID',
            paid_at: null,
            receipt_available: true,
          },
        ],
      }),
    });
    expect(await screen.findByText(/Payment received/)).toBeTruthy();
  });

  it.each([
    ['error', /could not confirm the payment/],
    ['cancel', /was not paid/],
    ['failure', /was not paid/],
  ] as const)(
    'a %s return resolves the notice even while the order is pending or unknown',
    async (payment, text) => {
      const id = '00000000-0000-4000-8000-0000000002aa';
      setup({
        returnOrderId: id,
        payment,
        credits: credits({
          orders:
            payment === 'error'
              ? [
                  {
                    id,
                    name: 'Medium',
                    sms_count: 2000,
                    price_paisa: 180000,
                    status: 'PENDING_PAYMENT',
                    paid_at: null,
                    receipt_available: false,
                  },
                ]
              : [],
        }),
      });
      expect(await screen.findByText(text)).toBeTruthy();
    },
  );

  it('gives up with a calm line after the polling time', async () => {
    setup({ returnOrderId: '00000000-0000-4000-8000-0000000002aa', pollTimedOut: true });
    expect(await screen.findByText(/still waiting for bKash/)).toBeTruthy();
  });

  it('has no accessibility violations', async () => {
    setup({ credits: credits({ lots: [lot('a', 900, '2026-11-20T00:00:00Z')] }) });
    await screen.findByText('Medium');
    await expect(document.body).toHaveNoViolations();
  });
});
