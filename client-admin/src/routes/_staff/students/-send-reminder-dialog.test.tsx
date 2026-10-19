import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { SendReminderDialog } from './-send-reminder-dialog';

/** [2621] The server rejects more than 500 students; the dialog says so before a request. */

const ids = (n: number) => Array.from({ length: n }, (_, i) => `s${i}`);

function Host({ studentIds }: { studentIds: readonly string[] }) {
  const [open, setOpen] = React.useState(true);
  return (
    <>
      <button onClick={() => setOpen(true)}>reopen</button>
      <SendReminderDialog
        open={open}
        onOpenChange={setOpen}
        studentIds={studentIds}
        onSent={() => {}}
      />
    </>
  );
}

function mount(studentIds: readonly string[]) {
  const root = createRootRoute();
  const home = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <Host studentIds={studentIds} />,
  });
  const wizard = createRoute({
    getParentRoute: () => root,
    path: '/communications/reminders',
    component: () => <p>wizard</p>,
  });
  return renderWithRouter(root.addChildren([home, wizard]), {
    initialEntries: ['/'],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
}

let posted: string[][] = [];
function mockPost(respond?: () => Response) {
  posted = [];
  server.use(
    http.post('/api/v1/communications/reminder/bulk', async ({ request }) => {
      posted.push(((await request.json()) as { student_ids: string[] }).student_ids);
      return (
        respond?.() ??
        HttpResponse.json(
          { id: 'b', status: 'COMPLETED', total_recipients: 1, successful_count: 1, skipped: [] },
          { status: 201 },
        )
      );
    }),
  );
}

describe('SendReminderDialog 500-student cap', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('500 ids: no notice, Send enabled, one POST with 500 ids', async () => {
    mockPost();
    mount(ids(500));
    const user = userEvent.setup();
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'Pay dues');
    expect(screen.queryByRole('status')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toHaveLength(500);
  });

  it('501 ids: notice with count and wizard link, Send disabled even with a message, no request', async () => {
    mockPost();
    mount(ids(501));
    const user = userEvent.setup();
    const notice = await screen.findByRole('status');
    expect(notice.textContent).toContain('501');
    expect(notice.textContent).toContain('500');
    expect(screen.getByRole('link').getAttribute('href')).toBe('/communications/reminders');
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Pay dues');
    const send = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    await user.click(send);
    expect(posted).toHaveLength(0);
  });

  it('a 400 naming student_ids shows the limit text, a 500 shows the generic error', async () => {
    mockPost(() =>
      HttpResponse.json(
        {
          statusCode: 400,
          message: ['student_ids must contain no more than 500 elements'],
          requestId: 'r1',
          path: '/x',
          timestamp: 't',
        },
        { status: 400 },
      ),
    );
    mount(ids(3));
    const user = userEvent.setup();
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'x');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('500');
    expect(alert.textContent).not.toContain('try again');
  });

  it('a 400 for a bad id is not the cap: generic error, no limit text', async () => {
    mockPost(() =>
      HttpResponse.json(
        {
          statusCode: 400,
          message: ['each value in student_ids must be a UUID'],
          requestId: 'r3',
          path: '/x',
          timestamp: 't',
        },
        { status: 400 },
      ),
    );
    mount(ids(3));
    const user = userEvent.setup();
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'x');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Nothing was sent');
    expect(alert.textContent).not.toContain('500');
  });

  it('a server 500 says the outcome is unknown, never "Nothing was sent"', async () => {
    mockPost(() =>
      HttpResponse.json(
        { statusCode: 500, message: 'boom', requestId: 'r2', path: '/x', timestamp: 't' },
        { status: 500 },
      ),
    );
    mount(ids(3));
    const user = userEvent.setup();
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'x');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("couldn't confirm");
    expect(alert.textContent).not.toContain('Nothing was sent');
  });
});
