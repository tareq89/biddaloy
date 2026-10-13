import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The form has a "check status" Link; there is no router in this test.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="/">{children}</a>,
}));

const INTAKE = {
  id: 'intake-1',
  title: 'Class 1, 2026',
  seat_count: 30,
  open_date: '2026-01-01',
  close_date: '2026-12-31',
  required_document_types: [],
};

afterEach(async () => {
  vi.doUnmock('../registration/turnstile');
  vi.resetModules();
  await cleanupTestState();
});

/** Loads the form with the Turnstile module stubbed: `siteKey` '' means "no widget". */
async function setup(siteKey: string) {
  vi.doMock('../registration/turnstile', () => ({
    TURNSTILE_SITE_KEY: siteKey,
    NO_CAPTCHA_TOKEN: 'no-captcha',
    Turnstile: ({ onToken }: { onToken: (t: string | null) => void }) => (
      <button type="button" data-testid="solve-captcha" onClick={() => onToken('tok')} />
    ),
  }));
  const { PublicAdmissionForm } = await import('./PublicAdmissionForm');
  const posted: string[] = [];
  server.use(
    http.get('/api/v1/public/admission/:slug', () => HttpResponse.json([INTAKE])),
    http.post('/api/v1/public/admission/:slug/applicants', async ({ request }) => {
      posted.push((await request.formData()).get('captcha_token') as string);
      return HttpResponse.json({ reference_number: 'ADM-2026-000001', status: 'PENDING' });
    }),
  );
  const view = renderWithProviders(<PublicAdmissionForm slug="a-school" onSubmitted={vi.fn()} />, {
    locale: 'en',
  });
  await view.localeReady;
  const user = userEvent.setup();
  await waitFor(() => expect(screen.getByLabelText(/Student's full name/)).toBeTruthy());
  return { user, posted };
}

async function fillValid(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/Student's full name/), 'Rahim Ahmed');
  await user.click(screen.getByRole('button', { name: "Student's date of birth" }));
  const now = new Date();
  const first = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  await user.click(
    await waitFor(() => {
      const el = document.querySelector<HTMLElement>(`[data-date="${first}"]`);
      if (!el) throw new Error('calendar not open');
      return el;
    }),
  );
  await user.click(screen.getByRole('combobox', { name: /Student's gender/ }));
  await user.click(await screen.findByRole('option', { name: 'Boy' }));
  await user.type(screen.getByLabelText(/Parent\/guardian's name/), 'Karim Ahmed');
  await user.type(screen.getByLabelText(/Parent\/guardian's phone number/), '1712345678');
}

describe('PublicAdmissionForm captcha', () => {
  it('blocks a submit with no token and shows the captcha message', async () => {
    const { user, posted } = await setup('test-key');
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: 'Submit application' }));
    expect(await screen.findByText('Please complete the check above.')).toBeTruthy();
    expect(posted).toEqual([]);
  });

  it('sends the solved token', async () => {
    const { user, posted } = await setup('test-key');
    await fillValid(user);
    await user.click(screen.getByTestId('solve-captcha'));
    await user.click(screen.getByRole('button', { name: 'Submit application' }));
    await waitFor(() => expect(posted).toEqual(['tok']));
  });

  it('sends the no-captcha token when there is no site key', async () => {
    const { user, posted } = await setup('');
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: 'Submit application' }));
    await waitFor(() => expect(posted).toEqual(['no-captcha']));
  });
});
