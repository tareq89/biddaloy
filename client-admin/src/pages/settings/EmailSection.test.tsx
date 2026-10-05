import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EmailSection } from './EmailSection';

const SCHOOL_ID = 'school-1';

const CONFIGURED_EMAIL = {
  host: 'smtp.example.com',
  port: 587,
  user: 'noreply',
  from: 'noreply@example.com',
  password: { configured: true, hint: '••••pass' },
};

describe('EmailSection', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('runs the connection test with the current form values', async () => {
    const testBody = vi.fn();
    server.use(
      http.post('/api/v1/schools/:id/settings/test', async ({ request }) => {
        testBody(await request.json());
        return HttpResponse.json({ success: true, message: 'Connected.' });
      }),
    );

    const { user } = renderWithProviders(
      <EmailSection schoolId={SCHOOL_ID} email={CONFIGURED_EMAIL} />,
      { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID },
    );

    await user.click(await screen.findByRole('button', { name: 'Test connection' }));

    await waitFor(() => expect(testBody).toHaveBeenCalled());
    expect(testBody.mock.calls[0]![0]).toEqual({
      medium: 'EMAIL',
      config: { host: 'smtp.example.com', port: 587, user: 'noreply', from: 'noreply@example.com' },
    });
  });

  it('does not run the connection test with an invalid, unsaved from address', async () => {
    // Regression: handleTestConnection used to read form.getValues()
    // directly, bypassing the schema — an invalid `from` address (or a
    // port outside 1–65535) would still reach the connection-test
    // endpoint instead of being caught by the same validation Save uses.
    const testBody = vi.fn();
    server.use(
      http.post('/api/v1/schools/:id/settings/test', async ({ request }) => {
        testBody(await request.json());
        return HttpResponse.json({ success: true, message: 'Connected.' });
      }),
    );

    const { user } = renderWithProviders(
      <EmailSection schoolId={SCHOOL_ID} email={CONFIGURED_EMAIL} />,
      { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID },
    );

    const fromField = await screen.findByLabelText(/^Send emails from/);
    await user.clear(fromField);
    await user.type(fromField, 'not-an-email');

    await user.click(screen.getByRole('button', { name: 'Test connection' }));

    // The error shows under the field (the card has no summary).
    await waitFor(() => expect(fromField.getAttribute('aria-invalid')).toBe('true'));
    expect(testBody).not.toHaveBeenCalled();
  });

  it('opens Advanced when the port is invalid', async () => {
    const { user, container } = renderWithProviders(
      <EmailSection schoolId={SCHOOL_ID} email={CONFIGURED_EMAIL} />,
      { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID },
    );

    const port = await screen.findByLabelText('Port');
    const details = container.querySelector('details')!;
    expect(details.open).toBe(false);
    await user.clear(port);
    await user.type(port, '99999');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(details.open).toBe(true));
  });
});
