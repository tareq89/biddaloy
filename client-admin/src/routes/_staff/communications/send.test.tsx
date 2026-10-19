/**
 * [8.11.9]'s Send Message page — real route tree, same reasoning
 * `fees/generate.test.tsx` gives for itself.
 *
 * `POST /communications/send` has no server preview, so the shared
 * "nothing sends until the sender has seen exactly what will go out"
 * rule lives in the confirm dialog here — the first test pins that
 * nothing posts before the dialog's own confirm.
 */
import { REGION_BD_BN, REGION_BD_EN } from '@biddaloy/ui/i18n';
import {
  apiErrorBody,
  cleanupTestState,
  communicationFactory,
  guardianFactory,
  renderWithRouter,
  server,
  studentFactory,
} from '@biddaloy/ui/test';
import { formatNumber, formatPhone } from '@biddaloy/ui/utils';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

/** Counts render in the tenant region's numerals (Bangla by default). */
const n = (value: number) => formatNumber(value, REGION_BD_BN);

const GUARDIAN = guardianFactory({
  id: 'guardian-1',
  full_name: 'Rahima Begum',
  relationship: 'Mother',
  phone: '+8801700000001',
  email: 'rahima@example.com',
});

/** No phone on file — what makes "guardian switch must always overwrite
 * the address" observable for the SMS channel. */
const GUARDIAN_NO_PHONE = guardianFactory({
  id: 'guardian-2',
  full_name: 'Karim Uddin',
  relationship: 'Father',
  phone: null,
  email: 'karim@example.com',
});

const STUDENT = studentFactory({
  id: 'student-1',
  full_name: 'Arif Hossain',
  registration_number: '12345678',
  guardians: [GUARDIAN, GUARDIAN_NO_PHONE],
});

const studentSearchHandler = () =>
  http.get('/api/v1/students', () =>
    HttpResponse.json({ data: [STUDENT], total: 1, page: 1, limit: 10, totalPages: 1 }),
  );

function render(role = 'ADMIN') {
  return renderWithRouter(routeTree, {
    initialEntries: ['/communications/send'],
    tenantId: 'tenant-1',
    role,
    locale: 'en',
  });
}

/** [#2259] A message needs a guardian of the school: pick the student, then a guardian. */
async function pickGuardian(
  user: ReturnType<typeof userEvent.setup>,
  name = 'Rahima Begum (Mother)',
) {
  await user.type(screen.getByRole('textbox', { name: 'Student' }), 'Arif');
  await user.click(await screen.findByRole('button', { name: /Arif Hossain · 12345678/ }));
  await user.click(await screen.findByRole('radio', { name }));
}

async function fillBasicSmsMessage(user: ReturnType<typeof userEvent.setup>) {
  await pickGuardian(user);
  await user.click(screen.getByRole('textbox', { name: 'Message' }));
  await user.paste('School closed tomorrow.');
}

describe('/communications/send', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('restates recipient and message in a confirm dialog, and posts nothing before confirm', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      studentSearchHandler(),
      http.post('/api/v1/communications/send', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          communicationFactory({
            id: 'log-1',
            status: 'QUEUED',
            recipient_name: 'Rahima Begum',
          }),
          { status: 201 },
        );
      }),
      http.get('/api/v1/communications/:id', ({ params }) =>
        HttpResponse.json(communicationFactory({ id: params['id'] as string, status: 'QUEUED' })),
      ),
    );

    const user = userEvent.setup();
    render();
    await screen.findByRole('heading', { name: 'Send Message' });
    await fillBasicSmsMessage(user);
    await user.click(screen.getByRole('button', { name: 'Review and send' }));

    // The dialog is the review step: recipient, channel and the full
    // message, restated before anything can go out.
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain(
      `Rahima Begum · ${formatPhone('+8801700000001', REGION_BD_EN)}`,
    );
    expect(dialog.textContent).toContain('SMS');
    expect(dialog.textContent).toContain('School closed tomorrow.');
    // Nothing has been posted yet — confirm is what sends.
    expect(body).toBeUndefined();

    await user.click(screen.getByRole('button', { name: 'Send message' }));

    await screen.findByText('Message on its way');
    // The address is never sent: the server reads it from the guardian's record.
    expect(body).toEqual({
      medium: 'SMS',
      guardian_id: GUARDIAN.id,
      student_id: STUDENT.id,
      message_body: 'School closed tomorrow.',
    });
    expect(screen.getByText('Queued')).toBeTruthy();
  });

  it('keeps Send disabled until a guardian is picked', async () => {
    server.use(studentSearchHandler());
    const user = userEvent.setup();
    render();
    await screen.findByRole('heading', { name: 'Send Message' });
    const send = screen.getByRole<HTMLButtonElement>('button', { name: 'Review and send' });
    expect(send.disabled).toBe(true);
    // No free address or name inputs any more.
    expect(screen.queryByRole('textbox', { name: 'Recipient name' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Mobile number' })).toBeNull();

    await user.type(screen.getByRole('textbox', { name: 'Student' }), 'Arif');
    await user.click(await screen.findByRole('button', { name: /Arif Hossain · 12345678/ }));
    expect(send.disabled).toBe(true);

    await user.click(await screen.findByRole('radio', { name: 'Rahima Begum (Mother)' }));
    expect(send.disabled).toBe(false);
  });

  it('shows the guardian address read-only and follows the channel; no address keeps Send disabled', async () => {
    server.use(studentSearchHandler());
    const user = userEvent.setup();
    render();
    await screen.findByRole('heading', { name: 'Send Message' });
    await pickGuardian(user);
    const send = screen.getByRole<HTMLButtonElement>('button', { name: 'Review and send' });

    // Read-only text, not an input.
    expect(screen.getByText('Mobile number').closest('dl')?.textContent).toContain(
      formatPhone('+8801700000001', REGION_BD_EN),
    );
    expect(send.disabled).toBe(false);

    await user.click(screen.getByRole('combobox', { name: 'Send by' }));
    await user.click(await screen.findByRole('option', { name: 'Email' }));
    expect(screen.getByText('Email address').closest('dl')?.textContent).toContain(
      'rahima@example.com',
    );

    // The father has no phone: the SMS channel cannot go to him.
    await user.click(screen.getByRole('combobox', { name: 'Send by' }));
    await user.click(await screen.findByRole('option', { name: 'SMS' }));
    await user.click(screen.getByRole('radio', { name: 'Karim Uddin (Father)' }));
    expect(screen.getByText('Mobile number').closest('dl')?.textContent).toContain(
      'no address for this channel',
    );
    expect(send.disabled).toBe(true);
  });

  // Same rule as the server's addressForMedium: phone, else alternate phone.
  it('uses the alternate phone when the guardian has no main phone', async () => {
    const altOnly = guardianFactory({
      id: 'guardian-3',
      full_name: 'Salma Khatun',
      relationship: 'Aunt',
      phone: null,
      alternate_phone: '+8801700000009',
      email: null,
    });
    server.use(
      http.get('/api/v1/students', () =>
        HttpResponse.json({
          data: [{ ...STUDENT, guardians: [altOnly] }],
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        }),
      ),
    );
    const user = userEvent.setup();
    render();
    await screen.findByRole('heading', { name: 'Send Message' });
    await pickGuardian(user, 'Salma Khatun (Aunt)');

    expect(screen.getByText('Mobile number').closest('dl')?.textContent).toContain(
      formatPhone('+8801700000009', REGION_BD_EN),
    );
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Review and send' }).disabled,
    ).toBe(false);
  });

  it('shows the subject field for EMAIL and template fields for WHATSAPP only', async () => {
    const user = userEvent.setup();
    render();
    await screen.findByRole('heading', { name: 'Send Message' });

    // SMS (default): neither the subject nor the WhatsApp template fields.
    expect(screen.queryByRole('textbox', { name: 'Subject' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Template name' })).toBeNull();

    await user.click(screen.getByRole('combobox', { name: 'Send by' }));
    await user.click(await screen.findByRole('option', { name: 'Email' }));
    expect(screen.getByRole('textbox', { name: 'Subject' })).toBeTruthy();

    await user.click(screen.getByRole('combobox', { name: 'Send by' }));
    await user.click(await screen.findByRole('option', { name: 'WhatsApp' }));
    expect(screen.queryByRole('textbox', { name: 'Subject' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Template name' })).toBeTruthy();
    expect(screen.getByText(/24 hours/)).toBeTruthy();
  });

  it('shows the SMS segment counter for the SMS channel in a live region', async () => {
    const user = userEvent.setup();
    render();
    await screen.findByRole('heading', { name: 'Send Message' });

    await user.click(screen.getByRole('textbox', { name: 'Message' }));
    await user.paste('School closed tomorrow.');

    const counter = screen.getByText(`${n(23)} characters · ${n(1)} SMS`);
    expect(counter.getAttribute('aria-live')).toBe('polite');
  });

  it.each([
    [
      'GUARDIAN_NO_ADDRESS',
      'This guardian has no number or email for this channel. Pick another channel or guardian.',
    ],
    ['GUARDIAN_NOT_LINKED', 'This guardian is not linked to the chosen student.'],
  ])('maps a 400 %s to its own translated message', async (code, text) => {
    server.use(
      studentSearchHandler(),
      http.post('/api/v1/communications/send', () =>
        HttpResponse.json(
          {
            ...apiErrorBody(400, 'raw server text', '/api/v1/communications/send'),
            details: { code },
          },
          { status: 400 },
        ),
      ),
    );
    const user = userEvent.setup();
    render();
    await screen.findByRole('heading', { name: 'Send Message' });
    await fillBasicSmsMessage(user);
    await user.click(screen.getByRole('button', { name: 'Review and send' }));
    await user.click(await screen.findByRole('button', { name: 'Send message' }));

    expect((await screen.findByRole('alert')).textContent).toBe(text);
    expect(screen.queryByText('raw server text')).toBeNull();
  });

  it('shows one translated sentence for a server 400, never the server text, and keeps the dialog open', async () => {
    const serverMessage = 'message_body must be a string';
    server.use(
      studentSearchHandler(),
      http.post('/api/v1/communications/send', () =>
        HttpResponse.json(apiErrorBody(400, serverMessage, '/api/v1/communications/send'), {
          status: 400,
        }),
      ),
    );

    const user = userEvent.setup();
    render();
    await screen.findByRole('heading', { name: 'Send Message' });
    await fillBasicSmsMessage(user);
    await user.click(screen.getByRole('button', { name: 'Review and send' }));
    await user.click(await screen.findByRole('button', { name: 'Send message' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(
      "Something in the number, email or message isn't right. Check it and try again.",
    );
    expect(screen.queryByText(serverMessage)).toBeNull();
    // Still on the dialog — the user can fix and re-confirm.
    expect(screen.getByRole('dialog')).toBeTruthy();

    // Closing the dialog drops the stale error.
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Review and send' }));
    await screen.findByRole('dialog');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the guardian phone formatted in the radio row and lets "Change" clear the student', async () => {
    server.use(studentSearchHandler());
    const user = userEvent.setup();
    render();
    await screen.findByRole('heading', { name: 'Send Message' });

    await user.type(screen.getByRole('textbox', { name: 'Student' }), 'Arif');
    await user.click(await screen.findByRole('button', { name: /Arif Hossain · 12345678/ }));
    const row = (await screen.findByRole('radio', { name: 'Rahima Begum (Mother)' })).closest(
      'label',
    );
    expect(row?.textContent).toContain(formatPhone('+8801700000001', REGION_BD_EN));

    await user.click(screen.getByRole('button', { name: 'Change' }));
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Student' })).toBeTruthy();
  });

  it('renders the SMS counter in Bangla digits under a bn tenant', async () => {
    const user = userEvent.setup();
    renderWithRouter(routeTree, {
      initialEntries: ['/communications/send'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'bn',
    });
    const message = await screen.findByRole('textbox', { name: 'বার্তা' });
    await user.click(message);
    await user.paste('School closed tomorrow.');
    const counter = await screen.findByText(/অক্ষর/);
    expect(counter.textContent).toBe('২৩ অক্ষর · ১টি এসএমএস');
  });

  it('cannot be closed while the send is in flight, so it cannot be sent twice', async () => {
    let posts = 0;
    server.use(studentSearchHandler());
    // The response waits for the test, not a timer: on a busy runner a fixed
    // delay can elapse before the Escape check, closing the dialog first.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    server.use(
      http.post('/api/v1/communications/send', async () => {
        posts += 1;
        await held;
        return HttpResponse.json(communicationFactory({ status: 'QUEUED' }), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    render();
    await screen.findByRole('heading', { name: 'Send Message' });
    await fillBasicSmsMessage(user);
    await user.click(screen.getByRole('button', { name: 'Review and send' }));
    await user.click(await screen.findByRole('button', { name: 'Send message' }));

    await waitFor(() => expect(posts).toBe(1));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Cancel' }).disabled).toBe(true);
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeTruthy();

    release();
    await screen.findByText('Message on its way');
    expect(posts).toBe(1);
  });

  // [8.14.17]: `_staff.tsx`'s `RequirePermission` now refuses the whole
  // route in place with the shared `AccessDeniedState` copy, replacing
  // this route's own hand-rolled "You cannot send messages" text.
  it('shows the forbidden message to a role without COMMUNICATION_SEND', async () => {
    render('EXECUTIVE');

    expect(await screen.findByText("You don't have access to this page.")).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Message' })).toBeNull();
  });

  it('is axe clean with the confirm dialog open', async () => {
    server.use(studentSearchHandler());
    const user = userEvent.setup();
    const { container } = render();
    await screen.findByRole('heading', { name: 'Send Message' });
    await fillBasicSmsMessage(user);
    await user.click(screen.getByRole('button', { name: 'Review and send' }));
    await screen.findByRole('dialog');

    await expect(container).toHaveNoViolations();
  });

  describe('[#2604] result panel', () => {
    async function sendAndGetResult(log: Parameters<typeof communicationFactory>[0]) {
      server.use(
        studentSearchHandler(),
        http.post('/api/v1/communications/send', () =>
          HttpResponse.json(
            communicationFactory({ id: 'log-1', status: 'QUEUED', recipient_name: 'Rahima Begum' }),
            { status: 201 },
          ),
        ),
        http.get('/api/v1/communications/:id', () =>
          HttpResponse.json(communicationFactory({ id: 'log-1', ...log })),
        ),
      );
      const user = userEvent.setup();
      render();
      await screen.findByRole('heading', { name: 'Send Message' });
      await fillBasicSmsMessage(user);
      await user.click(screen.getByRole('button', { name: 'Review and send' }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Send message' }));
    }

    it('keeps the "on its way" wording while QUEUED', async () => {
      await sendAndGetResult({ status: 'QUEUED' });
      expect(await screen.findByRole('heading', { name: 'Message on its way' })).toBeDefined();
      expect(screen.queryByRole('link', { name: /Settings/ })).toBeNull();
    });

    it('FAILED with the not-configured reason: failure heading, mapped reason, settings link', async () => {
      await sendAndGetResult({
        status: 'FAILED',
        error: 'SMS (Greenweb) is not configured for this tenant. Add a gateway in Settings.',
      });
      expect(await screen.findByRole('heading', { name: 'Message not sent' })).toBeDefined();
      expect(screen.queryByText('Message on its way')).toBeNull();
      expect(screen.getByText(/not set up for this school/)).toBeDefined();
      expect(screen.queryByText(/Greenweb/)).toBeNull();
      const link = screen.getByRole('link', { name: 'Open Settings › Communication' });
      expect(link.getAttribute('href')).toContain('/settings');
    });

    it('FAILED with another reason: generic text, no raw server text, no link', async () => {
      await sendAndGetResult({ status: 'FAILED', error: 'Provider exploded: code 77' });
      expect(await screen.findByRole('heading', { name: 'Message not sent' })).toBeDefined();
      expect(screen.getByText('Could not be sent.')).toBeDefined();
      expect(screen.queryByText(/code 77/)).toBeNull();
      expect(screen.queryByRole('link', { name: /Settings/ })).toBeNull();
    });
  });
});
