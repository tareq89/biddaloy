import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { UserRole } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

const QUEUES = {
  queues: [
    { name: 'alpha-mail', available: true, waiting: 1, failed: 0 },
    { name: 'sms', available: true, waiting: 4, failed: 3 },
    { name: 'zeta-export', available: true, waiting: 0, failed: 9 },
  ],
};
const SYSTEM = {
  appVersion: '1.42.0',
  lastMigration: '1790000000000-AddThing',
  database: 'ok',
  redis: 'ok',
  restoring: [{ schoolId: 's-1', schoolName: 'Ananta School', jobStatus: 'RUNNING', locked: true }],
};
const APPROVAL = {
  statusCode: 403,
  message: 'x',
  timestamp: '',
  path: '/',
  requestId: 'r',
  details: { code: 'APPROVAL_REQUIRED' },
};

const serve = (system: object = SYSTEM) =>
  server.use(
    http.get('*/platform/ops/queues', () => HttpResponse.json(QUEUES)),
    http.get('*/platform/ops/system', () => HttpResponse.json(system)),
  );
const render = () =>
  renderWithRouter(routeTree, {
    initialEntries: ['/operations'],
    tenantId: 'tenant-1',
    role: UserRole.SUPER_ADMIN,
    locale: 'en',
  });

afterEach(async () => {
  await cleanupTestState();
});

describe('/operations', () => {
  it('lists queues with the most failed first', async () => {
    serve();
    render();
    await screen.findByText('zeta-export');
    const rows = screen.getAllByRole('row').map((r) => r.textContent ?? '');
    const order = ['zeta-export', 'sms', 'alpha-mail'].map((n) =>
      rows.findIndex((t) => t.includes(n)),
    );
    expect(order.every((i) => i > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('retry asks for the code, retries, then refetches', async () => {
    serve();
    let queuesCalls = 0;
    const tokens: (string | null)[] = [];
    server.use(
      http.get('*/platform/ops/queues', () => {
        queuesCalls += 1;
        return HttpResponse.json(QUEUES);
      }),
      http.post('*/platform/ops/queues/sms/retry-failed', ({ request }) => {
        const token = request.headers.get('X-Approval-Token');
        tokens.push(token);
        return token
          ? HttpResponse.json({ retried: 3 })
          : HttpResponse.json(APPROVAL, { status: 403 });
      }),
    );
    const user = userEvent.setup();
    render();
    await user.click(await screen.findByRole('button', { name: 'Retry failed jobs of sms' }));
    await user.type(await screen.findByLabelText('Authenticator code'), '123456');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(tokens).toEqual([null, 'owner-token']));
    await waitFor(() => expect(queuesCalls).toBeGreaterThan(1));
  });

  it('names Redis when it is down', async () => {
    serve({ ...SYSTEM, redis: 'fail' });
    render();
    expect(await screen.findByText(/Not working: Redis\./)).toBeTruthy();
  });

  it('release: confirm says the owner checked, then asks for the code', async () => {
    serve();
    const tokens: (string | null)[] = [];
    server.use(
      http.post('*/platform/ops/restore-lock/s-1/release', ({ request }) => {
        const token = request.headers.get('X-Approval-Token');
        tokens.push(token);
        return token
          ? HttpResponse.json({ released: true, failedJobs: 0 })
          : HttpResponse.json(APPROVAL, { status: 403 });
      }),
    );
    const user = userEvent.setup();
    render();
    await user.click(
      await screen.findByRole('button', { name: 'Release the lock of Ananta School' }),
    );
    const confirm = await screen.findByRole('alertdialog');
    expect(within(confirm).getByText(/checked that no restore is running/)).toBeTruthy();
    await user.click(within(confirm).getByRole('button', { name: 'Release' }));
    await user.type(await screen.findByLabelText('Authenticator code'), '123456');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(tokens).toEqual([null, 'owner-token']));
  });

  it('shows an error sentence when the queues fail to load', async () => {
    serve();
    server.use(
      http.get('*/platform/ops/queues', () =>
        HttpResponse.json({ statusCode: 500, message: 'x' }, { status: 500 }),
      ),
    );
    render();
    expect(await screen.findByText('Could not load operations. Try again.')).toBeTruthy();
  });
});

describe('platformOperations locale', () => {
  // Never-say words, docs/ux-research/tenant-control-glossary.md (D14).
  const NEVER = [
    'impersonate',
    'act as',
    'break-glass',
    'consent',
    'session',
    'revoke',
    'kill',
    'mode',
    'policy',
    'justification',
    'user_id',
  ];
  const root = resolve(__dirname, '../../../../../ui/src/i18n/locales');
  const strings = (locale: string): string[] => {
    const out: string[] = [];
    const walk = (v: unknown) =>
      typeof v === 'string' ? out.push(v) : Object.values(v as object).forEach(walk);
    walk(JSON.parse(readFileSync(`${root}/${locale}/platformOperations.json`, 'utf8')));
    return out;
  };

  it.each(['en', 'bn'])('%s has no never-say word', (locale) => {
    const text = strings(locale).join('\n').toLowerCase();
    for (const word of NEVER) expect(text, word).not.toMatch(new RegExp(`\\b${word}\\b`));
  });

  it('bn and en have the same number of strings', () => {
    expect(strings('bn')).toHaveLength(strings('en').length);
  });
});
