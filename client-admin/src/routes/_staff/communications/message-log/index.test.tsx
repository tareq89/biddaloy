/**
 * [87.SD] / [97.4.02] `/communications/message-log` — filters in the URL, row detail, Check
 * status. Real route tree, MSW-backed (D10: no vendor stub, the API layer is the seam).
 */
import { toast } from '@biddaloy/ui/components';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

const STUDENT = '11111111-1111-4111-8111-111111111111';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'log-1',
  medium: 'SMS',
  recipient_address: '01712345678',
  recipient_name: 'Karim Uddin',
  status: 'SENT',
  trigger: 'MANUAL',
  student_id: 's-1',
  guardian_id: 'g-1',
  provider_message_id: 'vendor-1',
  provider: 'greenweb',
  error: null,
  created_at: '2026-10-20T09:00:00.000Z',
  ...over,
});

const page = (data: unknown[]) => ({
  data,
  total: data.length,
  page: 1,
  limit: 25,
  totalPages: data.length ? 1 : 0,
});

const providers = {
  SMS: {
    providers: [
      {
        medium: 'SMS',
        name: 'greenweb',
        label: { en: 'Greenweb', bn: 'গ্রিনওয়েব' },
        capabilities: ['status'],
        fields: [],
        supportsTestMessage: true,
      },
      {
        medium: 'SMS',
        name: 'nostatus',
        label: { en: 'NoStatus SMS', bn: 'নো' },
        capabilities: [],
        fields: [],
        supportsTestMessage: true,
      },
    ],
    configured: true,
    selected: 'greenweb',
  },
};

function mockLogs(data: unknown[], onQuery?: (q: URLSearchParams) => void) {
  server.use(
    http.get('/api/v1/communications/logs', ({ request }) => {
      onQuery?.(new URL(request.url).searchParams);
      return HttpResponse.json(page(data));
    }),
    http.get(/\/api\/v1\/schools\/[^/]+\/settings\/messaging\/providers$/, () =>
      HttpResponse.json(providers),
    ),
  );
}

function render(path: string) {
  return renderWithRouter(routeTree, {
    initialEntries: [path],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
}

async function openDetail() {
  const [button] = await screen.findAllByRole('button', { name: 'View message' });
  fireEvent.click(button!);
  return await screen.findByRole('dialog');
}

describe('/communications/message-log', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTestState();
  });

  it('passes every URL filter to the API and lists the failed message with its reason', async () => {
    let query: URLSearchParams | null = null;
    mockLogs([row({ status: 'FAILED', error: 'NO_PROVIDER', provider_message_id: null })], (q) => {
      query = q;
    });
    render(
      '/communications/message-log?medium=SMS&status=FAILED&search=Karim&trigger=MANUAL&sent_by=u-1&provider=greenweb&from_date=2026-10-01&to_date=2026-10-31',
    );

    expect(await screen.findByText('Karim Uddin')).toBeTruthy();
    expect(screen.getAllByText('Failed').length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(query?.get('status')).toBe('FAILED');
      expect(query?.get('medium')).toBe('SMS');
      expect(query?.get('search')).toBe('Karim');
      expect(query?.get('trigger')).toBe('MANUAL');
      expect(query?.get('sent_by')).toBe('u-1');
      expect(query?.get('provider')).toBe('greenweb');
      expect(query?.get('from_date')).toBe('2026-10-01');
      expect(query?.get('to_date')).toBe('2026-10-31');
    });
  });

  it('shows the plain empty state', async () => {
    mockLogs([]);
    render('/communications/message-log');
    expect(await screen.findByText('No messages found.')).toBeTruthy();
  });

  it('says no message matches when a filter is on', async () => {
    mockLogs([]);
    render('/communications/message-log?status=FAILED');
    expect(await screen.findByText('No messages match these filters')).toBeTruthy();
  });

  it('shows an error line when the log cannot load', async () => {
    server.use(
      http.get('/api/v1/communications/logs', () =>
        HttpResponse.json({ statusCode: 400, message: 'bad' }, { status: 400 }),
      ),
    );
    render('/communications/message-log');
    expect(await screen.findByText('Could not load the message log.')).toBeTruthy();
  });

  it('row detail renders every field', async () => {
    mockLogs([row()]);
    render('/communications/message-log');
    const dialog = await openDetail();
    const d = within(dialog);
    expect(d.getByText('Karim Uddin')).toBeTruthy();
    expect(d.getByText('Sent by staff')).toBeTruthy();
    expect(d.getByText('Greenweb')).toBeTruthy();
    expect(d.getByText('vendor-1')).toBeTruthy();
    expect(d.getByText('Message details')).toBeTruthy();
  });

  it.each([
    ['SENT with id and capability', {}, true],
    ['DELIVERED', { status: 'DELIVERED' }, false],
    ['FAILED', { status: 'FAILED' }, false],
    ['QUEUED', { status: 'QUEUED' }, false],
    ['no company message id', { provider_message_id: null }, false],
    ['company without the capability', { provider: 'nostatus' }, false],
  ])('Check status button, %s', async (_name, over, shown) => {
    mockLogs([row(over)]);
    render('/communications/message-log');
    const dialog = await openDetail();
    // The providers list arrives separately; wait for the company label before judging.
    await within(dialog).findByText(
      (over as { provider?: string }).provider === 'nostatus' ? 'NoStatus SMS' : 'Greenweb',
    );
    expect(!!within(dialog).queryByRole('button', { name: 'Check status' })).toBe(shown);
  });

  it('Check status posts once with an Idempotency-Key and updates the row in place', async () => {
    mockLogs([row()]);
    const toastSpy = vi.spyOn(toast, 'success').mockImplementation(() => '');
    const keys: (string | null)[] = [];
    server.use(
      http.post('/api/v1/communications/logs/log-1/check-status', ({ request }) => {
        keys.push(request.headers.get('Idempotency-Key'));
        return HttpResponse.json(row({ status: 'DELIVERED' }));
      }),
    );
    render('/communications/message-log');
    const dialog = await openDetail();
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Check status' }));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith('Status updated.'));
    expect(keys).toHaveLength(1);
    expect(keys[0]).toBeTruthy();
    await waitFor(() =>
      expect(within(screen.getByRole('dialog')).getAllByText('Delivered').length).toBeGreaterThan(
        0,
      ),
    );
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: 'Check status' })).toBe(
      null,
    );
  });

  it.each([
    [409, 'The delivery status of this message cannot be checked now.'],
    [502, 'Could not get the delivery status. Try again in a minute.'],
  ])('Check status %s shows the server sentence, once, with no retry', async (status, message) => {
    mockLogs([row()]);
    const toastSpy = vi.spyOn(toast, 'error').mockImplementation(() => '');
    let calls = 0;
    server.use(
      http.post('/api/v1/communications/logs/log-1/check-status', () => {
        calls += 1;
        return HttpResponse.json(
          {
            statusCode: status,
            message,
            requestId: 'r-1',
            path: '/',
            timestamp: '2026-10-31T00:00:00Z',
          },
          { status },
        );
      }),
    );
    render('/communications/message-log');
    const dialog = await openDetail();
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Check status' }));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(message));
    expect(calls).toBe(1);
    // Still SENT: the button stays for another try.
    expect(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Check status' }),
    ).toBeTruthy();
  });

  it('disables Check status while the request is pending', async () => {
    mockLogs([row()]);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post('/api/v1/communications/logs/log-1/check-status', async () => {
        await gate;
        return HttpResponse.json(row());
      }),
    );
    render('/communications/message-log');
    const dialog = await openDetail();
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Check status' }));
    const busy = await within(dialog).findByRole('button', { name: /Checking/ });
    expect((busy as HTMLButtonElement).disabled || busy.getAttribute('aria-busy') === 'true').toBe(
      true,
    );
    release();
    await waitFor(() =>
      expect(within(dialog).queryByRole('button', { name: /Checking/ })).toBe(null),
    );
  });

  it('?student= reads the student endpoint and offers no Check status', async () => {
    let hit = '';
    server.use(
      http.get(`/api/v1/communications/student/${STUDENT}`, ({ request }) => {
        hit = new URL(request.url).pathname;
        return HttpResponse.json([row({ provider: undefined, trigger: undefined })]);
      }),
    );
    render(`/communications/message-log?student=${STUDENT}`);
    expect(await screen.findByText('Karim Uddin')).toBeTruthy();
    expect(hit).toContain(STUDENT);
    expect(screen.getByText('Show all messages')).toBeTruthy();
    const dialog = await openDetail();
    expect(within(dialog).queryByRole('button', { name: 'Check status' })).toBe(null);
  });
});
