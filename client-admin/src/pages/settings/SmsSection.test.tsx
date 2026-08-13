import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SmsSection } from './SmsSection';

const SCHOOL_ID = 'school-1';

describe('SmsSection', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('sends only the selected gateway in the saved payload', async () => {
    const patchBody = vi.fn();
    server.use(
      http.patch('/api/v1/schools/:id/settings', async ({ request }) => {
        patchBody(await request.json());
        return HttpResponse.json({ version: 1, region: {}, communications: {} });
      }),
    );

    const { user } = renderWithProviders(
      <SmsSection
        schoolId={SCHOOL_ID}
        sms={{ provider: 'greenweb', greenweb: { apiKey: { configured: true, hint: '••••key1' } } }}
      />,
      { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID },
    );

    await user.click(await screen.findByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patchBody).toHaveBeenCalled());
    const sms = patchBody.mock.calls[0]![0].communications.sms;
    expect(sms.provider).toBe('greenweb');
    expect(sms.greenweb).toBeDefined();
    expect(sms.mimsms).toBeUndefined();
  });

  it('preserves a typed GreenWeb key when switching to MIMSMS and back', async () => {
    const patchBody = vi.fn();
    server.use(
      http.patch('/api/v1/schools/:id/settings', async ({ request }) => {
        patchBody(await request.json());
        return HttpResponse.json({ version: 1, region: {}, communications: {} });
      }),
    );

    const { user } = renderWithProviders(
      <SmsSection
        schoolId={SCHOOL_ID}
        sms={{ provider: 'greenweb', greenweb: { apiKey: { configured: true, hint: '••••key1' } } }}
      />,
      { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID },
    );

    await user.click(await screen.findByRole('button', { name: 'Replace' }));
    await user.type(await screen.findByLabelText('Greenweb API key'), 'gw-typed-key');

    const providerSelect = screen.getByLabelText('Provider');
    await user.selectOptions(providerSelect, 'MimSMS');
    await user.selectOptions(providerSelect, 'Greenweb');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patchBody).toHaveBeenCalled());
    const sms = patchBody.mock.calls[0]![0].communications.sms;
    expect(sms.provider).toBe('greenweb');
    expect(sms.greenweb.apiKey).toBe('gw-typed-key');
  });
});
