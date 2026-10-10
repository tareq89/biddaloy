/** [67.5.05] The composer: gating, preview count, exact POST body, errors, discard. */
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SendAlertForm } from './send-alert-form';

function renderForm(onClose = vi.fn()) {
  server.use(http.get('*/attention/manual', () => HttpResponse.json({ items: [], total: 0 })));
  const root = createRootRoute();
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <SendAlertForm onClose={onClose} />,
  });
  renderWithRouter(root.addChildren([index]), {
    initialEntries: ['/'],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
  return onClose;
}

async function fill(user: ReturnType<typeof userEvent.setup>, roles: string[] = ['Teacher']) {
  await user.type(await screen.findByLabelText('Title'), 'Fee deadline');
  await user.type(screen.getByLabelText('Message'), 'Pay by Sunday');
  await user.click(screen.getByRole('checkbox', { name: 'By role' }));
  for (const role of roles) {
    // Typing (not clicking) reopens the list while the input still has focus.
    await user.type(await screen.findByRole('combobox', { name: 'Add a role' }), role);
    await user.click(await screen.findByRole('option', { name: role }));
  }
}

const preview = (recipientCount: number) =>
  http.post('*/attention/manual/preview', () => HttpResponse.json({ recipientCount }));

describe('SendAlertForm', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('starts on Warning with Send disabled and a reason', async () => {
    renderForm();
    expect(
      (await screen.findByRole('radio', { name: /warning/i })).getAttribute('aria-checked'),
    ).toBe('true');
    expect(screen.getByRole('button', { name: 'Send' })).toHaveProperty('disabled', true);
    expect(screen.getByText('Write a title first.')).toBeTruthy();
  });

  it('shows the recipient count and sends the exact body on Ctrl+Enter', async () => {
    const user = userEvent.setup();
    let body: Record<string, unknown> | null = null;
    server.use(
      preview(7),
      http.post('*/attention/manual', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: 'a-1', recipientCount: 7 }, { status: 201 });
      }),
    );
    const onClose = renderForm();
    await fill(user);

    expect(await screen.findByText(/^[7৭] people in total$/)).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Send' })).toHaveProperty('disabled', false),
    );
    await user.keyboard('{Control>}{Enter}{/Control}');

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(body).toEqual({
      severity: 'WARNING',
      title: 'Fee deadline',
      body: 'Pay by Sunday',
      audience: { roles: ['TEACHER'] },
      expiresOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) as string,
    });
  });

  it('disables Send when nobody matches', async () => {
    const user = userEvent.setup();
    server.use(preview(0));
    renderForm();
    await fill(user);
    expect(await screen.findAllByText('Nobody matches these groups.')).not.toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Send' })).toHaveProperty('disabled', true);
  });

  it('shows the daily-limit message on a 429', async () => {
    const user = userEvent.setup();
    server.use(
      preview(3),
      http.post('*/attention/manual', () =>
        HttpResponse.json(
          {
            statusCode: 429,
            message: 'Daily limit of 20 alerts reached',
            timestamp: '2026-10-10T00:00:00.000Z',
            path: '/api/v1/attention/manual',
            requestId: 'req-1',
          },
          { status: 429 },
        ),
      ),
    );
    renderForm();
    await fill(user);
    await screen.findByText(/^[3৩] people in total$/);
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(
      await screen.findByText(/^Daily limit of [2২][0০] alerts reached\. Try again tomorrow\.$/),
    ).toBeTruthy();
  });

  it('asks before discarding what was typed', async () => {
    const user = userEvent.setup();
    const onClose = renderForm();
    await user.type(await screen.findByLabelText('Title'), 'x');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Discard this alert?')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('disables the link picker for a mixed audience', async () => {
    const user = userEvent.setup();
    server.use(preview(5));
    renderForm();
    await fill(user, ['Teacher', 'Parent']);
    expect(
      await screen.findByText('A link only works when everyone uses the same app.'),
    ).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Page to open (optional)' })).toHaveProperty(
      'disabled',
      true,
    );
  });
});
