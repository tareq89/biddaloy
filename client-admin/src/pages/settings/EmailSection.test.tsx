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

    const fromField = await screen.findByLabelText('From address');
    await user.clear(fromField);
    await user.type(fromField, 'not-an-email');

    await user.click(screen.getByRole('button', { name: 'Test connection' }));

    // Both the FormShell error summary and the per-field FormMessage carry
    // role="alert" — match on the summary's own heading text instead of
    // querying the role alone. The heading text is split across sibling
    // text nodes ("There is 1 problem" + " " + "with your submission"), so
    // a regex substring match is needed rather than an exact string.
    await waitFor(() => expect(screen.getByText(/There is 1 problem/)).toBeTruthy());
    expect(testBody).not.toHaveBeenCalled();
  });
});
