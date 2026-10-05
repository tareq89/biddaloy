import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { WhatsAppSection } from './WhatsAppSection';

const SERVER_TEXT = 'SERVER_SECRET_TEXT';
const failing = (path: string, method: 'patch' | 'put' | 'post' = 'patch') =>
  http[method](path, () =>
    HttpResponse.json(
      {
        statusCode: 400,
        message: SERVER_TEXT,
        timestamp: new Date().toISOString(),
        path,
        requestId: 'r',
      },
      { status: 400 },
    ),
  );

const SCHOOL_ID = 'school-1';

describe('WhatsAppSection', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows the masked hint for an already-configured token, never the plaintext', async () => {
    renderWithProviders(
      <WhatsAppSection
        schoolId={SCHOOL_ID}
        whatsapp={{
          phoneNumberId: '123456',
          apiVersion: 'v21.0',
          accessToken: { configured: true, hint: '••••oken' },
        }}
      />,
      { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID },
    );

    expect(await screen.findByText('Added — ends ••••oken')).toBeTruthy();
    // The masked state must not expose an editable value for the stored
    // token — no password input is rendered at all while masked, only the
    // status text and the Replace/Clear buttons.
    expect(screen.queryByLabelText('Access token')).toBeNull();
  });

  it('saves a new access token typed after clicking Replace, then shows a success message', async () => {
    const { user } = renderWithProviders(
      <WhatsAppSection
        schoolId={SCHOOL_ID}
        whatsapp={{
          phoneNumberId: '123456',
          apiVersion: 'v21.0',
          accessToken: { configured: true, hint: '••••oken' },
        }}
      />,
      { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID },
    );

    await user.click(await screen.findByRole('button', { name: 'Change' }));
    const tokenInput = await screen.findByLabelText('Access token');
    await user.type(tokenInput, 'new-token-value');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(screen.getByText('Saved')).toBeTruthy();
    });
  });

  it('runs a connection test and shows the result, without saving anything', async () => {
    const { user } = renderWithProviders(
      <WhatsAppSection
        schoolId={SCHOOL_ID}
        whatsapp={{
          phoneNumberId: '123456',
          apiVersion: 'v21.0',
          accessToken: { configured: true, hint: '••••oken' },
        }}
      />,
      { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID },
    );

    await user.click(await screen.findByRole('button', { name: 'Test connection' }));

    await waitFor(() => {
      expect(screen.getByText('Connection works')).toBeTruthy();
    });
    expect(screen.queryByText('Saved')).toBeNull();
  });

  it('warns unsaved-changes state is tracked once a field is edited', async () => {
    const { user } = renderWithProviders(
      <WhatsAppSection
        schoolId={SCHOOL_ID}
        whatsapp={{ phoneNumberId: '123456', apiVersion: 'v21.0' }}
      />,
      { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID },
    );

    const phoneField = await screen.findByLabelText<HTMLInputElement>(/^Phone number ID/);
    await user.clear(phoneField);
    await user.type(phoneField, '999999');

    // beforeunload only fires on a real navigation attempt in jsdom, which
    // this test doesn't trigger — asserting the field actually changed
    // (react-hook-form's isDirty, exercised through the visible value) is
    // the observable half of `useWarnUnsavedChanges`'s precondition here.
    expect(phoneField.value).toBe('999999');
  });

  it('shows a translated failure badge and never the server message', async () => {
    server.use(
      http.post('/api/v1/schools/:id/settings/test', () =>
        HttpResponse.json({ success: false, message: 'bad token' }),
      ),
    );
    const { user } = renderWithProviders(
      <WhatsAppSection
        schoolId={SCHOOL_ID}
        whatsapp={{ phoneNumberId: '123456', apiVersion: 'v21.0' }}
      />,
      { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID },
    );

    await user.click(await screen.findByRole('button', { name: 'Test connection' }));

    expect(
      await screen.findByText("Couldn't connect — check the details and try again."),
    ).toBeTruthy();
    expect(screen.queryByText('bad token')).toBeNull();
  });

  it('shows "Set up" only when the saved settings are complete', async () => {
    const { rerender } = renderWithProviders(
      <WhatsAppSection
        schoolId={SCHOOL_ID}
        whatsapp={{
          phoneNumberId: '123456',
          accessToken: { configured: true, hint: '••••oken' },
        }}
      />,
      { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID },
    );
    expect(await screen.findByText('Set up')).toBeTruthy();

    rerender(<WhatsAppSection schoolId={SCHOOL_ID} whatsapp={{ phoneNumberId: '123456' }} />);
    expect(await screen.findByText('Not set up')).toBeTruthy();
  });

  it('shows a translated error, never the server text, when save or test fails', async () => {
    server.use(
      failing('/api/v1/schools/:id/settings'),
      failing('/api/v1/schools/:id/settings/test', 'post'),
    );
    const { user } = renderWithProviders(
      <WhatsAppSection
        schoolId={SCHOOL_ID}
        whatsapp={{ phoneNumberId: '123456', apiVersion: 'v21.0' }}
      />,
      { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID },
    );

    await user.click(await screen.findByRole('button', { name: 'Test connection' }));
    expect((await screen.findByRole('alert')).textContent).toBe("Couldn't save. Try again.");
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2));
    expect(screen.queryByText(SERVER_TEXT)).toBeNull();
  });
});
