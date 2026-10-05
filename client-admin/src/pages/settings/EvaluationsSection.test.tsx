import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EvaluationsSection } from './EvaluationsSection';
import { WithTestRouter } from './with-test-router';

const SCHOOL_ID = 'school-1';
const LABEL = 'Send an SMS when a new incident report is filed';
const opts = { locale: 'en' as const, role: 'ADMIN' as const, tenantId: SCHOOL_ID };

describe('EvaluationsSection', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('defaults off and shows the privacy copy', async () => {
    renderWithProviders(
      <WithTestRouter>
        <EvaluationsSection schoolId={SCHOOL_ID} evaluations={undefined} />
      </WithTestRouter>,
      opts,
    );
    const box = await screen.findByLabelText(LABEL);
    expect(box.getAttribute('aria-checked')).toBe('false');
    expect(
      screen.getByText(
        'The SMS says only that a new report exists, never what it says. Push notifications are always on.',
      ),
    ).toBeTruthy();
  });

  it('with no provider: a warning badge, a link to Communication, and an alert when the toggle is on', async () => {
    renderWithProviders(
      <WithTestRouter>
        <EvaluationsSection schoolId={SCHOOL_ID} evaluations={{ incidentSmsEnabled: true }} />
      </WithTestRouter>,
      opts,
    );
    expect(await screen.findByText('No SMS provider is set up.')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Communication › set up SMS' }).getAttribute('href'),
    ).toBe('/settings?section=communication');
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Incident SMS will not be sent until an SMS provider is set up in Communication.',
    );
  });

  it('with a provider: a success badge, no link and no alert', async () => {
    renderWithProviders(
      <WithTestRouter>
        <EvaluationsSection
          schoolId={SCHOOL_ID}
          evaluations={{ incidentSmsEnabled: true }}
          smsConfigured
        />
      </WithTestRouter>,
      opts,
    );
    expect(await screen.findByText('SMS provider is set up')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Communication › set up SMS' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('saves only the evaluations slice with the flag on', async () => {
    const patchBody = vi.fn();
    server.use(
      http.patch('/api/v1/schools/:id/settings', async ({ request }) => {
        patchBody(await request.json());
        return HttpResponse.json({ version: 1 });
      }),
    );
    const { user } = renderWithProviders(
      <WithTestRouter>
        <EvaluationsSection schoolId={SCHOOL_ID} evaluations={undefined} />
      </WithTestRouter>,
      opts,
    );
    await user.click(await screen.findByLabelText(LABEL));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patchBody).toHaveBeenCalled());
    expect(patchBody.mock.calls[0]![0]).toEqual({
      version: 1,
      evaluations: { incidentSmsEnabled: true },
    });
  });

  it('renders checked from stored true and saves false after unchecking', async () => {
    const patchBody = vi.fn();
    server.use(
      http.patch('/api/v1/schools/:id/settings', async ({ request }) => {
        patchBody(await request.json());
        return HttpResponse.json({ version: 1 });
      }),
    );
    const { user } = renderWithProviders(
      <WithTestRouter>
        <EvaluationsSection schoolId={SCHOOL_ID} evaluations={{ incidentSmsEnabled: true }} />
      </WithTestRouter>,
      opts,
    );
    const box = await screen.findByLabelText(LABEL);
    expect(box.getAttribute('aria-checked')).toBe('true');
    await user.click(box);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patchBody).toHaveBeenCalled());
    expect(patchBody.mock.calls[0]![0]).toEqual({
      version: 1,
      evaluations: { incidentSmsEnabled: false },
    });
  });
});
