import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { providersHandler } from './provider-config-form.fixtures';
import { ProviderConfigForm, type MessagingMedium } from './ProviderConfigForm';
import { WithTestRouter } from './with-test-router';

const CARD = 'Card';
const SCHOOL_ID = 'school-1';
const OPTS = { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID } as const;

function renderForm(medium: MessagingMedium, saved: Record<string, unknown> | undefined) {
  return renderWithProviders(
    <WithTestRouter>
      <ProviderConfigForm
        medium={medium}
        schoolId={SCHOOL_ID}
        saved={saved}
        sectionId="x-section"
        title={CARD}
        description="Card description"
      />
    </WithTestRouter>,
    OPTS,
  );
}

function captureSave() {
  const body = vi.fn();
  server.use(
    http.patch('/api/v1/schools/:id/settings', async ({ request }) => {
      body(await request.json());
      return HttpResponse.json({ version: 1, region: {}, communications: {} });
    }),
  );
  return body;
}

const SAVED_SMS = {
  provider: 'greenweb',
  greenweb: { apiKey: { configured: true, hint: '••••key1' } },
  mimsms: { senderId: 'OLD', apiKey: { configured: true, hint: '••••mim1' } },
};

describe('ProviderConfigForm', () => {
  beforeEach(() => {
    server.use(providersHandler({ SMS: true }));
  });
  afterEach(async () => {
    await cleanupTestState();
  });

  it("renders the selected company's fields from the descriptor, API address only under Advanced", async () => {
    const { container } = renderForm('SMS', SAVED_SMS);

    expect(await screen.findByLabelText('SMS company')).toBeTruthy();
    expect(screen.getByText('Added — ends ••••key1')).toBeTruthy();
    expect(screen.getByText('Set up')).toBeTruthy();
    const details = container.querySelector('details')!;
    expect(details.open).toBe(false);
    expect(details.contains(screen.getByLabelText('API address (optional)'))).toBe(true);
    // help text is looked up from help.messaging.<company>.<field>
    expect(screen.getByText("Leave empty to use the company's own address.")).toBeTruthy();
  });

  it('offers OneCodeSoft and shows its API address help', async () => {
    const { user } = renderForm('SMS', SAVED_SMS);

    await user.click(await screen.findByLabelText('SMS company'));
    await user.click(await screen.findByRole('option', { name: 'OneCodeSoft' }));

    expect(await screen.findByLabelText(/^API address/)).toBeTruthy();
    expect(
      screen.getByText(
        'Copy the base address from OneCodeSoft Dashboard › API. It must end with /api.',
      ),
    ).toBeTruthy();
  });

  it('omits an untouched secret, sends a typed one, and sends null for Remove', async () => {
    const body = captureSave();
    const { user } = renderForm('SMS', SAVED_SMS);

    await user.click(await screen.findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(body).toHaveBeenCalledTimes(1));
    expect(body.mock.calls[0]![0].communications.sms).toEqual({
      provider: 'greenweb',
      greenweb: {},
    });

    await user.click(screen.getByRole('button', { name: 'Change' }));
    await user.type(await screen.findByLabelText('API key'), 'typed-key');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(body).toHaveBeenCalledTimes(2));
    expect(body.mock.calls[1]![0].communications.sms.greenweb.apiKey).toBe('typed-key');
  });

  it('sends null when the secret is removed', async () => {
    const body = captureSave();
    const { user } = renderForm('SMS', SAVED_SMS);

    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(body).toHaveBeenCalled());
    expect(body.mock.calls[0]![0].communications.sms.greenweb.apiKey).toBeNull();
  });

  it('shows an inline required error and does not save', async () => {
    server.use(providersHandler({ SMS: false }, 'mimsms'));
    const body = captureSave();
    const { user } = renderForm('SMS', { provider: 'mimsms', mimsms: {} });

    await user.click(await screen.findByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Fill in this field.')).toBeTruthy();
    expect(body).not.toHaveBeenCalled();
  });

  it('sends only the chosen company, so other saved companies stay untouched', async () => {
    const body = captureSave();
    const { user } = renderForm('SMS', SAVED_SMS);

    await user.click(await screen.findByLabelText('SMS company'));
    await user.click(await screen.findByRole('option', { name: 'MimSMS' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(body).toHaveBeenCalled());
    const sms = body.mock.calls[0]![0].communications.sms;
    expect(sms.provider).toBe('mimsms');
    expect(sms.mimsms.senderId).toBe('OLD');
    expect(sms.greenweb).toBeUndefined();
  });

  it('keeps a typed key when switching company and back', async () => {
    const body = captureSave();
    const { user } = renderForm('SMS', SAVED_SMS);

    await user.click(await screen.findByRole('button', { name: 'Change' }));
    await user.type(await screen.findByLabelText('API key'), 'gw-typed-key');
    await user.click(screen.getByLabelText('SMS company'));
    await user.click(await screen.findByRole('option', { name: 'MimSMS' }));
    await user.click(screen.getByLabelText('SMS company'));
    await user.click(await screen.findByRole('option', { name: 'Greenweb' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(body).toHaveBeenCalled());
    expect(body.mock.calls[0]![0].communications.sms.greenweb.apiKey).toBe('gw-typed-key');
  });

  it('sole company: no picker, nested payload without provider', async () => {
    const body = captureSave();
    const { user } = renderForm('WHATSAPP', {
      'meta-cloud': { phoneNumberId: '123', accessToken: { configured: true, hint: '••••tok' } },
    });

    expect(await screen.findByLabelText(/^Phone number ID/)).toBeTruthy();
    expect(screen.queryByLabelText('WhatsApp company')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(body).toHaveBeenCalled());
    expect(body.mock.calls[0]![0].communications.whatsapp).toEqual({
      'meta-cloud': { phoneNumberId: '123' },
    });
  });

  it('reads the old flat saved layout of a sole company', async () => {
    renderForm('WHATSAPP', { phoneNumberId: '777' });
    expect((await screen.findByLabelText<HTMLInputElement>(/^Phone number ID/)).value).toBe('777');
  });

  it('shows the send-a-test-message row only for companies that support it', async () => {
    renderForm('WHATSAPP', undefined);
    await screen.findByLabelText(/^Phone number ID/);
    expect(screen.queryByRole('button', { name: 'Send a test message' })).toBeNull();
  });

  it('sends a test message with sendTo and an Idempotency-Key, then links to the message log', async () => {
    const seen = vi.fn();
    server.use(
      http.post('/api/v1/schools/:id/settings/test', async ({ request }) => {
        seen({ body: await request.json(), key: request.headers.get('Idempotency-Key') });
        return HttpResponse.json({
          success: true,
          message: 'Connected to Greenweb.',
          testMessage: { logId: 'log-1', status: 'SENT' },
        });
      }),
    );
    const { user } = renderForm('SMS', SAVED_SMS);

    await user.type(await screen.findByLabelText('Phone number'), '01712345678');
    await user.click(screen.getByRole('button', { name: 'Send a test message' }));

    expect(await screen.findByText(/Sent\./)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See it in Message log' })).toBeTruthy();
    expect(seen.mock.calls[0]![0].body.sendTo).toBe('01712345678');
    expect(seen.mock.calls[0]![0].key).toBeTruthy();
  });

  it('shows the daily-limit sentence on a 429', async () => {
    server.use(
      http.post('/api/v1/schools/:id/settings/test', () =>
        HttpResponse.json(
          {
            statusCode: 429,
            message: 'cap',
            timestamp: new Date().toISOString(),
            path: '/x',
            requestId: 'r',
          },
          { status: 429 },
        ),
      ),
    );
    const { user } = renderForm('SMS', SAVED_SMS);

    await user.type(await screen.findByLabelText('Phone number'), '01712345678');
    await user.click(screen.getByRole('button', { name: 'Send a test message' }));

    expect(await screen.findByText(/limit for test messages/)).toBeTruthy();
  });

  it('keeps the port and from-address checks', async () => {
    const body = captureSave();
    const { user } = renderForm('EMAIL', {
      smtp: { host: 'h', user: 'u', from: 'bad', password: { configured: true } },
    });

    await user.click(await screen.findByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Check this value.')).toBeTruthy();
    expect(body).not.toHaveBeenCalled();
  });
});
