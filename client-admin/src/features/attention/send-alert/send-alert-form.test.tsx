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

const sendFails = (status: number, message: string | string[], details?: object) =>
  http.post('*/attention/manual', () =>
    HttpResponse.json(
      {
        statusCode: status,
        message,
        timestamp: '2026-10-10T00:00:00.000Z',
        path: '/api/v1/attention/manual',
        requestId: 'req-1',
        ...(details ? { details } : {}),
      },
      { status },
    ),
  );

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

  it.each([
    [
      'the daily cap',
      sendFails(429, 'Daily limit of 20 alerts reached', {
        code: 'MANUAL_DAILY_LIMIT',
        limit: 20,
      }),
      /^Daily limit of [2২][0০] alerts reached\. Try again tomorrow\.$/,
    ],
    [
      'the per-minute throttle',
      sendFails(429, 'ThrottlerException: Too Many Requests'),
      /^Too many tries\. Wait a minute and try again\.$/,
    ],
    [
      'an audience that emptied',
      sendFails(400, 'No one matches this audience', { code: 'MANUAL_NO_RECIPIENTS' }),
      /^Nobody matches these groups\.$/,
    ],
    [
      'a class-validator field error (own copy, not the English server text)',
      sendFails(400, ['title should not be empty']),
      /^Check the title\.$/,
    ],
  ])('explains a failed send: %s', async (_name, handler, text) => {
    const user = userEvent.setup();
    server.use(preview(3), handler);
    renderForm();
    await fill(user);
    await screen.findByText(/^[3৩] people in total$/);
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(text)).toBeTruthy();
  });

  it('does not send on Ctrl+Enter while a confirm dialog is open', async () => {
    const user = userEvent.setup();
    let posted = false;
    server.use(
      preview(3),
      http.post('*/attention/manual', () => {
        posted = true;
        return HttpResponse.json({ id: 'a-1', recipientCount: 3 }, { status: 201 });
      }),
    );
    renderForm();
    await fill(user);
    await screen.findByText(/^[3৩] people in total$/);
    // Esc opens the shell's own discard prompt, which this form does not track
    await user.keyboard('{Escape}');
    await screen.findByRole('alertdialog');
    await user.keyboard('{Control>}{Enter}{/Control}');
    await new Promise((r) => setTimeout(r, 50));
    expect(posted).toBe(false);
  });

  it('keeps the last count, marked stale, when the rate-limited preview answers 429', async () => {
    const user = userEvent.setup();
    let calls = 0;
    server.use(
      http.post('*/attention/manual/preview', () => {
        calls += 1;
        return calls === 1
          ? HttpResponse.json({ recipientCount: 5 })
          : HttpResponse.json(
              {
                statusCode: 429,
                message: 'Too many requests',
                timestamp: '2026-10-10T00:00:00.000Z',
                path: '/api/v1/attention/manual/preview',
                requestId: 'req-2',
              },
              { status: 429 },
            );
      }),
    );
    renderForm();
    await fill(user);
    expect(await screen.findByText(/^[5৫] people in total$/)).toBeTruthy();

    await user.type(screen.getByRole('combobox', { name: 'Add a role' }), 'Accountant');
    await user.click(await screen.findByRole('option', { name: 'Accountant' }));
    await waitFor(() => expect(calls).toBe(2));
    expect(await screen.findByText(/^[5৫] people in total$/)).toBeTruthy();
    // the kept count belongs to the previous audience, so it is marked as possibly stale
    expect(
      await screen.findByText('Could not refresh the count, so it may be out of date.'),
    ).toBeTruthy();
    expect(screen.queryByText('Nobody matches these groups.')).toBeNull();
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

  it('offers only pages every chosen role can open', async () => {
    const user = userEvent.setup();
    server.use(preview(5));
    renderForm();
    const link = await screen.findByRole('combobox', { name: 'Page to open (optional)' });
    // ADMIN sender, no audience yet: the sender's own pages, Send an alert included.
    await user.click(link);
    expect(await screen.findByRole('option', { name: 'Send an alert' })).toBeTruthy();
    await user.keyboard('{Escape}');

    await fill(user, ['Teacher']);
    await user.click(screen.getByRole('combobox', { name: 'Page to open (optional)' }));
    expect(await screen.findByRole('option', { name: 'No page' })).toBeTruthy();
    // a teacher cannot open the send-alert page, so it is not offered
    expect(screen.queryByRole('option', { name: 'Send an alert' })).toBeNull();
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
