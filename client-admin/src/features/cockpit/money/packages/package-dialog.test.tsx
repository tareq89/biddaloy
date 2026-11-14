import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PackageDialog } from './package-dialog';

const view = (onOpenChange = vi.fn()) =>
  renderWithProviders(<PackageDialog open onOpenChange={onOpenChange} />, {
    locale: 'en',
    role: 'SUPER_ADMIN',
    tenantId: 'platform',
  });

afterEach(async () => {
  await cleanupTestState();
});

async function fill(user: ReturnType<typeof userEvent.setup>, sms: string, days = '180') {
  await user.type(await screen.findByLabelText('Name'), '5,000 SMS');
  await user.type(screen.getByLabelText('Number of SMS'), sms);
  await user.type(screen.getByLabelText('Valid for (days)'), days);
  await user.type(screen.getByLabelText('Price (Tk)'), '1500');
}

const approvalRequired = () =>
  HttpResponse.json(
    {
      statusCode: 403,
      message: 'x',
      timestamp: '',
      path: '/',
      requestId: 'r',
      details: { code: 'APPROVAL_REQUIRED' },
    },
    { status: 403 },
  );

describe('PackageDialog', () => {
  it('asks for the code on save, then sends one create with an Idempotency-Key and taka price', async () => {
    const seen: { token: string | null; key: string | null; body: unknown }[] = [];
    server.use(
      http.post('*/platform/sms-packages', async ({ request }) => {
        const token = request.headers.get('X-Approval-Token');
        seen.push({
          token,
          key: request.headers.get('Idempotency-Key'),
          body: await request.json(),
        });
        return token ? HttpResponse.json({}, { status: 201 }) : approvalRequired();
      }),
    );
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    const { container } = view(onOpenChange);
    await fill(user, '5000');
    expect(screen.getByText(/^Each SMS costs Tk /)).toBeTruthy();
    expect(screen.getByText('How the school sees it')).toBeTruthy();
    await expect(container).toHaveNoViolations();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.type(await screen.findByLabelText('Authenticator code'), '123456');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(seen).toHaveLength(2);
    expect(seen[1]!.token).toBe('owner-token');
    expect(seen[1]!.key).toBeTruthy();
    expect(seen[1]!.body).toEqual({
      name: '5,000 SMS',
      smsCount: 5000,
      validityDays: 180,
      priceTaka: 1500,
    });
  });

  it.each([
    ['99', '180', /^Enter a whole number from .+ to /],
    ['1000001', '180', /^Enter a whole number from .+ to /],
    ['5000', '0', 'Enter a whole number of days from 1 to 365.'],
    ['5000', '366', 'Enter a whole number of days from 1 to 365.'],
    ['50', '400', /^Enter a whole number from .+ to /],
  ])('blocks SMS %s and %s days before any request', async (sms, days, sentence) => {
    let hit = false;
    server.use(http.post('*/platform/sms-packages', () => ((hit = true), HttpResponse.json({}))));
    const user = userEvent.setup();
    view();
    await fill(user, sms, days);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(sentence)).toBeTruthy();
    expect(hit).toBe(false);
  });

  it('shows one fixed sentence when the save fails, never the server text', async () => {
    server.use(
      http.post('*/platform/sms-packages', () =>
        HttpResponse.json({ statusCode: 400, message: 'secret detail' }, { status: 400 }),
      ),
    );
    const user = userEvent.setup();
    view();
    await fill(user, '5000');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Could not save. Try again.')).toBeTruthy();
    expect(screen.queryByText(/secret detail/)).toBeNull();
  });

  it('edit: prefills, asks for the code, then sends exactly one PATCH with the taka price', async () => {
    const seen: { token: string | null; body: unknown }[] = [];
    server.use(
      http.patch('*/platform/sms-packages/:id', async ({ request }) => {
        const token = request.headers.get('X-Approval-Token');
        seen.push({ token, body: await request.json() });
        return token ? HttpResponse.json({}) : approvalRequired();
      }),
    );
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <PackageDialog
        open
        onOpenChange={onOpenChange}
        pkg={{
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Big',
          smsCount: 5000,
          validityDays: 180,
          pricePaisa: '150000',
          priceTaka: '1500.00',
          active: true,
        }}
      />,
      { locale: 'en', role: 'SUPER_ADMIN', tenantId: 'platform' },
    );
    expect(await screen.findByDisplayValue('Big')).toBeTruthy();
    expect(screen.getByDisplayValue('5000')).toBeTruthy();
    expect(screen.getByDisplayValue('180')).toBeTruthy();
    const price = screen.getByLabelText('Price (Tk)');
    await user.clear(price);
    await user.type(price, '1600');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.type(await screen.findByLabelText('Authenticator code'), '123456');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(seen.filter((c) => c.token)).toHaveLength(1);
    expect(seen.at(-1)!.body).toMatchObject({ priceTaka: 1600 });
  });
});
