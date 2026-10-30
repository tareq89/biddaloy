import { apiErrorBody, cleanupTestState, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { ArrivalNoticeCard } from './-arrival-notice-card';
import { renderPortalCard } from './-card-test-utils';

const sub = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  student_id: 'kid-a',
  guardian_id: 'g1',
  status: 'REQUESTED',
  mode: 'ONCE',
  channel: 'PUSH',
  lock: 'NONE',
  consumed_at: null,
  declined_at: null,
  updated_at: '2026-09-15T10:00:00.000Z',
  ...over,
});

function mock(
  children: unknown[],
  school = { enabled: true, smsAllowed: true },
  puts: unknown[] = [],
) {
  server.use(
    http.get('/api/v1/portal/arrival-subscriptions', () => HttpResponse.json({ school, children })),
    http.put('/api/v1/portal/arrival-subscriptions/:id', async ({ request }) => {
      puts.push(await request.json());
      return HttpResponse.json(sub());
    }),
  );
}

describe('ArrivalNoticeCard', () => {
  afterEach(cleanupTestState);

  const kids = [
    { student_id: 'kid-a', student_name: 'Fatima', subscription: sub() },
    { student_id: 'kid-b', student_name: 'Imran', subscription: null },
  ];

  it('shows the waiting badge for a REQUESTED child', async () => {
    mock(kids);
    renderPortalCard(<ArrivalNoticeCard />);
    expect(await screen.findByText('Waiting for the teacher')).toBeTruthy();
    expect(screen.getByText('Imran')).toBeTruthy();
  });

  it('PUTs want and channel when the switch is flipped', async () => {
    const puts: unknown[] = [];
    mock(kids, undefined, puts);
    renderPortalCard(<ArrivalNoticeCard />);
    await userEvent.click(await screen.findByRole('switch', { name: /Imran/ }));
    await waitFor(() => expect(puts).toEqual([{ want: true, channel: 'PUSH' }]));
  });

  it('disables SMS when the school does not allow it', async () => {
    mock(kids, { enabled: true, smsAllowed: false });
    renderPortalCard(<ArrivalNoticeCard />);
    const sms = await screen.findByRole('radio', { name: 'By SMS' });
    expect((sms as HTMLButtonElement).disabled).toBe(true);
    // The reason is shown outside the faded row, where it keeps full contrast (axe sweep).
    const why = screen.getByText('Your school sends this in the app only');
    expect(why.closest('fieldset')).toBeNull();
  });

  it('turns a switched-off SMS row back on by app once the school stopped SMS', async () => {
    const puts: unknown[] = [];
    mock(
      [
        {
          student_id: 'kid-a',
          student_name: 'Fatima',
          subscription: sub({ status: 'OFF', channel: 'SMS' }),
        },
      ],
      { enabled: true, smsAllowed: false },
      puts,
    );
    renderPortalCard(<ArrivalNoticeCard />);
    await userEvent.click(await screen.findByRole('switch', { name: /Fatima/ }));
    await waitFor(() => expect(puts).toEqual([{ want: true, channel: 'PUSH' }]));
  });

  describe('no-push warning (D10: any device on the account counts)', () => {
    const active = [
      {
        student_id: 'kid-a',
        student_name: 'Fatima',
        subscription: sub({ status: 'ACTIVE', mode: 'RECURRING' }),
      },
    ];
    const noPush = 'No phone on your account has the app yet. Choose SMS or install the app.';

    it('warns, with a link to the devices section, when no device is registered', async () => {
      mock(active);
      server.use(http.get('/api/v1/me/push/subscriptions', () => HttpResponse.json([])));
      renderPortalCard(<ArrivalNoticeCard />);
      expect(await screen.findByText(noPush, { exact: false })).toBeTruthy();
      const link = screen.getByRole('link', { name: 'Turn on app messages' });
      expect(link.getAttribute('href')).toBe('/portal/account#push-devices');
    });

    it('stays quiet when another device on the account is registered', async () => {
      mock(active);
      server.use(
        http.get('/api/v1/me/push/subscriptions', () =>
          HttpResponse.json([
            { id: 'p1', device_label: 'Phone', created_at: '2026-09-01T00:00:00Z' },
          ]),
        ),
      );
      renderPortalCard(<ArrivalNoticeCard />);
      await screen.findByRole('switch', { name: /Fatima/ });
      await waitFor(() => expect(screen.queryByText(noPush, { exact: false })).toBeNull());
    });
  });

  it('disables the switch under a NEVER lock', async () => {
    mock([
      {
        student_id: 'kid-a',
        student_name: 'Fatima',
        subscription: sub({ lock: 'NEVER', status: 'OFF' }),
      },
    ]);
    renderPortalCard(<ArrivalNoticeCard />);
    const sw = await screen.findByRole('switch', { name: /Fatima/ });
    expect((sw as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByText('Set by the admin').length).toBeGreaterThan(0);
  });

  it('under an ALWAYS lock the switch is fixed but the guardian still picks how it is sent', async () => {
    mock([
      {
        student_id: 'kid-a',
        student_name: 'Fatima',
        subscription: sub({ lock: 'ALWAYS', status: 'ACTIVE', mode: 'RECURRING' }),
      },
    ]);
    renderPortalCard(<ArrivalNoticeCard />);
    const sw = await screen.findByRole('switch', { name: /Fatima/ });
    // The server answers 409 to "off" under ALWAYS, so the switch must not offer it (D35).
    expect((sw as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Set by the admin')).toBeTruthy();
    expect(
      screen.getByText('The admin has turned this on. You can still choose how it is sent.'),
    ).toBeTruthy();
    const sms = screen.getByRole('radio', { name: 'By SMS' });
    expect((sms as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows one fixed sentence when the save fails, never the server text', async () => {
    mock(kids);
    server.use(
      http.put('/api/v1/portal/arrival-subscriptions/:id', () =>
        HttpResponse.json(
          apiErrorBody(409, 'secret server text', '/api/v1/portal/arrival-subscriptions/kid-b'),
          { status: 409 },
        ),
      ),
    );
    renderPortalCard(<ArrivalNoticeCard />);
    await userEvent.click(await screen.findByRole('switch', { name: /Imran/ }));
    expect((await screen.findByRole('alert')).textContent).toBe('Could not save. Try again.');
    expect(screen.queryByText('secret server text')).toBeNull();
  });

  it('shows the school-off sentence on the 409 that says so', async () => {
    mock(kids);
    server.use(
      http.put('/api/v1/portal/arrival-subscriptions/:id', () =>
        HttpResponse.json(
          apiErrorBody(
            409,
            'Arrival notices are turned off at this school.',
            '/api/v1/portal/arrival-subscriptions/kid-b',
          ),
          { status: 409 },
        ),
      ),
    );
    renderPortalCard(<ArrivalNoticeCard />);
    await userEvent.click(await screen.findByRole('switch', { name: /Imran/ }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Arrival notices are turned off at this school.',
    );
  });

  it('hints when the teacher said not now (declined), but not when the guardian switched off', async () => {
    mock([
      {
        student_id: 'kid-a',
        student_name: 'Fatima',
        subscription: sub({ status: 'OFF', declined_at: '2026-09-16T10:00:00.000Z' }),
      },
      {
        student_id: 'kid-b',
        student_name: 'Imran',
        subscription: sub({ id: 's2', status: 'OFF' }),
      },
    ]);
    renderPortalCard(<ArrivalNoticeCard />);
    await screen.findByText('Fatima');
    expect(
      screen.getAllByText('Your teacher has not turned this on. You can ask again.'),
    ).toHaveLength(1);
  });

  it('renders nothing when the school switch is off', async () => {
    mock(kids, { enabled: false, smsAllowed: true });
    renderPortalCard(<ArrivalNoticeCard />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('Fatima')).toBeNull();
  });
});
