/** [80.2.02] The Message staff form: default group, check numbers, short credit, WhatsApp, errors, prefill. */
import { ApiError } from '@biddaloy/ui/api';
import { apiErrorBody, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

import { staffErrorKey } from './-staff-message-form';

const PERSON = '11111111-1111-4111-8111-111111111111';

const PREVIEW = {
  people: 5,
  with_phone: 4,
  skipped: [{ user_id: 'u9', name: 'Nasrin Akter', reason: 'no_phone' }],
  segments_each: 1,
  credits_needed: 4,
  balance: 100,
  shortfall: 0,
  whatsapp_template: { name: '', language: '', params: [] },
};

function render(entry = '/communications/staff-message', role = 'ADMIN') {
  server.use(
    http.get('/api/v1/users', () =>
      HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 0 }),
    ),
    http.get('/api/v1/designations', () => HttpResponse.json([])),
  );
  return renderWithRouter(routeTree, {
    initialEntries: [entry],
    tenantId: 'tenant-1',
    role,
    locale: 'en',
  });
}

async function typeAndCheck(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('textbox', { name: 'Message' }));
  await user.paste('School is closed tomorrow.');
  await user.click(screen.getByRole('button', { name: 'Check who gets it' }));
}

describe('staff message form', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('starts on All teachers with Choose more collapsed, and sends only after the check', async () => {
    let previewBody: Record<string, unknown> | undefined;
    let sent = false;
    server.use(
      http.post('/api/v1/communications/staff/preview', async ({ request }) => {
        previewBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(PREVIEW);
      }),
      http.post('/api/v1/communications/staff', () => {
        sent = true;
        return HttpResponse.json(
          { batch_id: 'b1', total_recipients: 5, queued: 4, failed: 0, skipped: PREVIEW.skipped },
          { status: 201 },
        );
      }),
    );
    const user = userEvent.setup();
    render();

    const teachers = await screen.findByRole('checkbox', { name: 'All teachers' });
    expect(teachers.getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByRole('combobox', { name: 'Role' })).toBeNull();
    // WhatsApp is not set up for this school, so only SMS exists.
    expect(screen.queryByRole('radio', { name: 'WhatsApp' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(true);

    await typeAndCheck(user);
    await screen.findByText('Nasrin Akter');
    expect(previewBody).toMatchObject({ audience: { teaching: true }, medium: 'SMS' });
    expect(sent).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Send' }));
    await user.click(await screen.findByRole('button', { name: 'Yes, send' }));
    await screen.findByText('Message on its way');
    expect(sent).toBe(true);
  });

  it('opens Choose more with role, designation and people', async () => {
    const user = userEvent.setup();
    render();
    await user.click(await screen.findByRole('button', { name: 'Choose more' }));
    expect(await screen.findByRole('combobox', { name: 'Role' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Designation' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Pick people' })).toBeTruthy();
  });

  it('disables Send when credit is short, and says by how much', async () => {
    server.use(
      http.post('/api/v1/communications/staff/preview', () =>
        HttpResponse.json({ ...PREVIEW, balance: 1, shortfall: 3 }),
      ),
    );
    const user = userEvent.setup();
    render();
    await typeAndCheck(user);

    expect(await screen.findByText(/You are short by/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(true);
  });

  it('shows the credit sentence for a 409 credit answer, never the server text', async () => {
    server.use(
      http.post('/api/v1/communications/staff/preview', () =>
        HttpResponse.json(
          {
            ...apiErrorBody(
              409,
              'Insufficient SMS credit to send this batch.',
              '/api/v1/communications/staff/preview',
            ),
            details: { code: 'INSUFFICIENT_SMS_CREDIT' },
          },
          { status: 409 },
        ),
      ),
    );
    const user = userEvent.setup();
    render();
    await typeAndCheck(user);

    expect(await screen.findByText(/not enough SMS credit/)).toBeTruthy();
    expect(screen.queryByText(/batch/)).toBeNull();
  });

  it('shows WhatsApp when the school has set it up', async () => {
    server.use(
      http.get('/api/v1/schools/tenant-1/settings', () =>
        HttpResponse.json({ communications: { whatsapp: { provider: 'meta' } } }),
      ),
    );
    const user = userEvent.setup();
    render();
    await user.click(await screen.findByRole('radio', { name: 'WhatsApp' }));
    expect(await screen.findByText('What will be delivered')).toBeTruthy();
  });

  it('prefills Pick people from ?people= and names them in the banner', async () => {
    server.use(
      http.get(`/api/v1/users/${PERSON}`, () =>
        HttpResponse.json({ id: PERSON, full_name: 'Rahima Begum' }),
      ),
    );
    render(`/communications/staff-message?people=${PERSON}`);

    expect(await screen.findByText('To: Rahima Begum')).toBeTruthy();
    expect(
      screen.getByRole('checkbox', { name: 'All teachers' }).getAttribute('aria-checked'),
    ).toBe('false');
    expect(screen.getByRole('combobox', { name: 'Pick people' })).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Rahima Begum', { selector: 'span,li,button' })));
  });

  it('ignores a malformed ?people= value', async () => {
    render('/communications/staff-message?people=not-an-id');
    expect(
      (await screen.findByRole('checkbox', { name: 'All teachers' })).getAttribute('aria-checked'),
    ).toBe('true');
    expect(screen.queryByText(/^To:/)).toBeNull();
  });
});

describe('staffErrorKey', () => {
  const err = (statusCode: number, message: string, details?: Record<string, unknown>) =>
    new ApiError({
      statusCode,
      message,
      timestamp: '',
      path: '',
      requestId: '',
      ...(details ? { details } : {}),
    });

  it.each([
    [err(403, 'x'), 'forbidden'],
    [err(409, 'x', { code: 'INSUFFICIENT_SMS_CREDIT' }), 'insufficientCredit'],
    [err(409, 'x'), 'duplicate'],
    [err(400, 'Too many people chosen.'), 'tooMany'],
    [err(400, 'No one in this audience has a phone number.'), 'noPhone'],
    [err(400, 'No staff to message in your classes.'), 'noCoordinated'],
    [err(400, 'anything else'), 'invalid'],
    [err(500, 'boom'), 'sendFailed'],
  ])('maps %#', (error, key) => {
    expect(staffErrorKey(error, 'sendFailed')).toBe(`staffMessage.errors.${key}`);
  });

  it('falls back for a non-API error', () => {
    expect(staffErrorKey(new Error('x'), 'previewFailed')).toBe(
      'staffMessage.errors.previewFailed',
    );
  });
});
