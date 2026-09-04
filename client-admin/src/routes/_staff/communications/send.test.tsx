/**
 * [8.11.9]'s Send Message page — real route tree, same reasoning
 * `fees/generate.test.tsx` gives for itself.
 *
 * `POST /communications/send` has no server preview, so the shared
 * "nothing sends until the sender has seen exactly what will go out"
 * rule lives in the confirm dialog here — the first test pins that
 * nothing posts before the dialog's own confirm.
 */
import {
  apiErrorBody,
  cleanupTestState,
  communicationFactory,
  guardianFactory,
  renderWithRouter,
  server,
  studentFactory,
} from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

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

function addressInput() {
  return screen.getByRole<HTMLInputElement>('textbox', { name: 'Recipient address' });
}

function render(role = 'ADMIN') {
  return renderWithRouter(routeTree, {
    initialEntries: ['/communications/send'],
    tenantId: 'tenant-1',
    role,
    locale: 'en',
  });
}

async function fillBasicSmsMessage(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole('textbox', { name: 'Recipient name' }), 'Rahima Begum');
  await user.type(screen.getByRole('textbox', { name: 'Recipient address' }), '+8801700000001');
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
    expect(dialog.textContent).toContain('Rahima Begum — +8801700000001');
    expect(dialog.textContent).toContain('SMS');
    expect(dialog.textContent).toContain('School closed tomorrow.');
    // Nothing has been posted yet — confirm is what sends.
    expect(body).toBeUndefined();

    await user.click(screen.getByRole('button', { name: 'Send message' }));

    await screen.findByText('Message queued');
    expect(body).toEqual({
      medium: 'SMS',
      recipient_address: '+8801700000001',
      recipient_name: 'Rahima Begum',
      message_body: 'School closed tomorrow.',
    });
    expect(screen.getByText('Queued')).toBeTruthy();
  });

  it('prefills recipient name and address from a linked student guardian', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      studentSearchHandler(),
      http.post('/api/v1/communications/send', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(communicationFactory({ status: 'QUEUED' }), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    render();
    await screen.findByRole('heading', { name: 'Send Message' });

    await user.type(screen.getByRole('textbox', { name: 'Search students' }), 'Arif');
    await user.click(await screen.findByRole('button', { name: /Arif Hossain · 12345678/ }));
    await user.click(await screen.findByRole('radio', { name: 'Rahima Begum (Mother)' }));

    // SMS is the active channel, so the guardian's phone prefills.
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Recipient name' }).value).toBe(
      'Rahima Begum',
    );
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Recipient address' }).value).toBe(
      '+8801700000001',
    );

    await user.click(screen.getByRole('textbox', { name: 'Message' }));
    await user.paste('School closed tomorrow.');
    await user.click(screen.getByRole('button', { name: 'Review and send' }));
    await user.click(await screen.findByRole('button', { name: 'Send message' }));

    // The linked ids ride along so the message lands in both histories.
    await waitFor(() => expect(body).toBeDefined());
    expect(body?.['student_id']).toBe(STUDENT.id);
    expect(body?.['guardian_id']).toBe(GUARDIAN.id);
  });

  it("always overwrites the address on a guardian switch — never keeps the previous guardian's", async () => {
    server.use(studentSearchHandler());

    const user = userEvent.setup();
    render();
    await screen.findByRole('heading', { name: 'Send Message' });

    await user.type(screen.getByRole('textbox', { name: 'Search students' }), 'Arif');
    await user.click(await screen.findByRole('button', { name: /Arif Hossain · 12345678/ }));
    await user.click(await screen.findByRole('radio', { name: 'Rahima Begum (Mother)' }));
    expect(addressInput().value).toBe('+8801700000001');

    // The father has no phone for the active SMS channel. Keeping the
    // mother's number here would send his message to her phone while
    // logging it against him — the field must clear instead.
    await user.click(screen.getByRole('radio', { name: 'Karim Uddin (Father)' }));
    expect(addressInput().value).toBe('');
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Recipient name' }).value).toBe(
      'Karim Uddin',
    );
  });

  it('re-derives the address from the selected guardian when the channel changes', async () => {
    server.use(studentSearchHandler());

    const user = userEvent.setup();
    render();
    await screen.findByRole('heading', { name: 'Send Message' });

    await user.type(screen.getByRole('textbox', { name: 'Search students' }), 'Arif');
    await user.click(await screen.findByRole('button', { name: /Arif Hossain · 12345678/ }));
    await user.click(await screen.findByRole('radio', { name: 'Rahima Begum (Mother)' }));
    expect(addressInput().value).toBe('+8801700000001');

    // SMS → Email: her phone would be a nonsense email address
    // (`type=email`'s native check only fires at submit; `type=tel` never
    // does) — the field must follow the channel to her email.
    await user.click(screen.getByRole('combobox', { name: 'Channel' }));
    await user.click(await screen.findByRole('option', { name: 'Email' }));
    expect(addressInput().value).toBe('rahima@example.com');

    // Email → SMS: back to the phone.
    await user.click(screen.getByRole('combobox', { name: 'Channel' }));
    await user.click(await screen.findByRole('option', { name: 'SMS' }));
    expect(addressInput().value).toBe('+8801700000001');
  });

  it('clears a hand-typed address when the channel switches kind with no guardian selected', async () => {
    const user = userEvent.setup();
    render();
    await screen.findByRole('heading', { name: 'Send Message' });

    await user.type(addressInput(), '+8801700000009');

    // Phone-kind → email-kind: the typed phone can't be right.
    await user.click(screen.getByRole('combobox', { name: 'Channel' }));
    await user.click(await screen.findByRole('option', { name: 'Email' }));
    expect(addressInput().value).toBe('');

    // Email-kind → phone-kind: same in reverse.
    await user.type(addressInput(), 'someone@example.com');
    await user.click(screen.getByRole('combobox', { name: 'Channel' }));
    await user.click(await screen.findByRole('option', { name: 'WhatsApp' }));
    expect(addressInput().value).toBe('');
  });

  it('keeps a hand-typed phone across the SMS ↔ WhatsApp switch (same address kind)', async () => {
    const user = userEvent.setup();
    render();
    await screen.findByRole('heading', { name: 'Send Message' });

    await user.type(addressInput(), '+8801700000009');
    await user.click(screen.getByRole('combobox', { name: 'Channel' }));
    await user.click(await screen.findByRole('option', { name: 'WhatsApp' }));
    expect(addressInput().value).toBe('+8801700000009');
  });

  it('shows the subject field for EMAIL and template fields for WHATSAPP only', async () => {
    const user = userEvent.setup();
    render();
    await screen.findByRole('heading', { name: 'Send Message' });

    // SMS (default): neither the subject nor the WhatsApp template fields.
    expect(screen.queryByRole('textbox', { name: 'Subject' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Template name' })).toBeNull();

    await user.click(screen.getByRole('combobox', { name: 'Channel' }));
    await user.click(await screen.findByRole('option', { name: 'Email' }));
    expect(screen.getByRole('textbox', { name: 'Subject' })).toBeTruthy();

    await user.click(screen.getByRole('combobox', { name: 'Channel' }));
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

    const counter = screen.getByText('23 characters · 1 SMS segment');
    expect(counter.getAttribute('aria-live')).toBe('polite');
  });

  it('surfaces a server 400 verbatim inside the dialog and keeps it open', async () => {
    const serverMessage = 'recipient_address must be a valid phone number';
    server.use(
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
    expect(alert.textContent).toBe(serverMessage);
    // Still on the dialog — the user can fix and re-confirm.
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  // [8.14.17]: `_staff.tsx`'s `RequirePermission` now refuses the whole
  // route in place with the shared `AccessDeniedState` copy, replacing
  // this route's own hand-rolled "You cannot send messages" text.
  it('shows the forbidden message to a role without COMMUNICATION_SEND', async () => {
    render('EXECUTIVE');

    expect(await screen.findByText("You don't have access to this page.")).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Recipient name' })).toBeNull();
  });

  it('is axe clean with the confirm dialog open', async () => {
    const user = userEvent.setup();
    const { container } = render();
    await screen.findByRole('heading', { name: 'Send Message' });
    await fillBasicSmsMessage(user);
    await user.click(screen.getByRole('button', { name: 'Review and send' }));
    await screen.findByRole('dialog');

    await expect(container).toHaveNoViolations();
  });
});
