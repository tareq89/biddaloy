import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApplicationsSection } from './ApplicationsSection';
import { WithTestRouter } from './with-test-router';

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
const LABEL = 'Tell guardians the decision by SMS';
const opts = { locale: 'en' as const, role: 'ADMIN' as const, tenantId: SCHOOL_ID };

describe('ApplicationsSection', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('defaults off and shows the hint', async () => {
    renderWithProviders(
      <WithTestRouter>
        <ApplicationsSection schoolId={SCHOOL_ID} applications={undefined} />
      </WithTestRouter>,
      opts,
    );
    const box = await screen.findByLabelText(LABEL);
    expect(box.getAttribute('aria-checked')).toBe('false');
    expect(
      screen.getByText(
        'Only the final decision (approved or rejected) is sent. The in-app notice always goes.',
      ),
    ).toBeTruthy();
  });

  it('with no provider: a warning badge, a link to Communication, and an alert when the toggle is on', async () => {
    renderWithProviders(
      <WithTestRouter>
        <ApplicationsSection schoolId={SCHOOL_ID} applications={{ smsOnDecision: true }} />
      </WithTestRouter>,
      opts,
    );
    expect(await screen.findByText('No SMS company added.')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Communication › add SMS company' }).getAttribute('href'),
    ).toBe('/settings?section=communication');
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Decision SMS will not be sent until an SMS company is added in Communication.',
    );
  });

  it('with a provider: a success badge, no link and no alert', async () => {
    renderWithProviders(
      <WithTestRouter>
        <ApplicationsSection
          schoolId={SCHOOL_ID}
          applications={{ smsOnDecision: true }}
          smsConfigured
        />
      </WithTestRouter>,
      opts,
    );
    expect(await screen.findByText('SMS company added')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Communication › add SMS company' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('saves only the applications slice with the flag on', async () => {
    const patchBody = vi.fn();
    server.use(
      http.patch('/api/v1/schools/:id/settings', async ({ request }) => {
        patchBody(await request.json());
        return HttpResponse.json({ version: 1 });
      }),
    );
    const { user } = renderWithProviders(
      <WithTestRouter>
        <ApplicationsSection schoolId={SCHOOL_ID} applications={undefined} />
      </WithTestRouter>,
      opts,
    );
    await user.click(await screen.findByLabelText(LABEL));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patchBody).toHaveBeenCalled());
    expect(patchBody.mock.calls[0]![0]).toEqual({
      version: 1,
      applications: { smsOnDecision: true },
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
        <ApplicationsSection schoolId={SCHOOL_ID} applications={{ smsOnDecision: true }} />
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
      applications: { smsOnDecision: false },
    });
  });

  it('shows a translated error, never the server text, when the save fails', async () => {
    server.use(failing('/api/v1/schools/:id/settings'));
    const { user } = renderWithProviders(
      <WithTestRouter>
        <ApplicationsSection schoolId={SCHOOL_ID} applications={undefined} smsConfigured />
      </WithTestRouter>,
      opts,
    );

    await user.click(await screen.findByLabelText(LABEL));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect((await screen.findByRole('alert')).textContent).toBe("Couldn't save. Try again.");
    expect(screen.queryByText(SERVER_TEXT)).toBeNull();
  });
});
