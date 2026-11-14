import '@biddaloy/ui/test';

import { ApprovalModalHostProvider } from '@biddaloy/ui/hooks';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import bn from '../../../../../ui/src/i18n/locales/bn/school360.json';
import en from '../../../../../ui/src/i18n/locales/en/school360.json';

import { GlobalModulesCard, ModulesTab } from './modules-tab';

const opts = { locale: 'en', role: 'SUPER_ADMIN', tenantId: 'platform' } as const;
const host = (node: React.ReactNode) =>
  renderWithProviders(<ApprovalModalHostProvider>{node}</ApprovalModalHostProvider>, opts);

const err = (status: number, code?: string) =>
  HttpResponse.json(
    {
      statusCode: status,
      message: 'leaky server text',
      timestamp: '',
      path: '/',
      requestId: 'r',
      ...(code ? { details: { code } } : {}),
    },
    { status },
  );

const globalRead = (modules: Record<string, boolean>) =>
  http.get('*/platform/modules', () => HttpResponse.json({ modules }));
const schoolRead = (modules: object) =>
  http.get('*/platform/schools/:id/modules', () => HttpResponse.json({ modules }));

afterEach(async () => {
  await cleanupTestState();
});

describe('GlobalModulesCard', () => {
  it('lists the 17 modules from the map, absent key is On', async () => {
    server.use(globalRead({ website: false }));
    host(<GlobalModulesCard />);
    expect(
      (await screen.findByRole('switch', { name: 'Website' })).getAttribute('aria-checked'),
    ).toBe('false');
    expect(screen.getAllByRole('switch')).toHaveLength(17);
    expect(screen.getByRole('switch', { name: 'Fees' }).getAttribute('aria-checked')).toBe('true');
  });

  it('turning off asks first, then saves the FULL map; turning on needs no dialog', async () => {
    const bodies: unknown[] = [];
    let map: Record<string, boolean> = { website: false };
    server.use(
      http.get('*/platform/modules', () => HttpResponse.json({ modules: map })),
      http.put('*/platform/modules', async ({ request }) => {
        const body = (await request.json()) as { modules: Record<string, boolean> };
        bodies.push(body);
        map = body.modules;
        return HttpResponse.json(body);
      }),
    );
    const user = userEvent.setup();
    host(<GlobalModulesCard />);
    await user.click(await screen.findByRole('switch', { name: 'Fees' }));
    expect(await screen.findByText('This turns it off for every school.')).toBeTruthy();
    expect(bodies).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Turn off' }));
    await waitFor(() => expect(bodies).toEqual([{ modules: { website: false, fees: false } }]));
    await user.click(screen.getByRole('switch', { name: 'Website' }));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]).toEqual({ modules: { fees: false } });
  });

  it('a held refetch after a save cannot make the next save drop the first change', async () => {
    const bodies: { modules: Record<string, boolean> }[] = [];
    let map: Record<string, boolean> = { website: false };
    let hold: Promise<void> | null = null;
    let release = () => {};
    server.use(
      http.get('*/platform/modules', async () => {
        if (hold) await hold;
        return HttpResponse.json({ modules: map });
      }),
      http.put('*/platform/modules', async ({ request }) => {
        const body = (await request.json()) as { modules: Record<string, boolean> };
        bodies.push(body);
        map = body.modules;
        hold = new Promise<void>((r) => (release = r)); // hold only the refetch after the save
        return HttpResponse.json(body);
      }),
    );
    const user = userEvent.setup();
    host(<GlobalModulesCard />);
    await user.click(await screen.findByRole('switch', { name: 'Fees' }));
    await user.click(await screen.findByRole('button', { name: 'Turn off' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    // Refetch is still held: a click now (if allowed at all) must still carry fees:false.
    await user.click(screen.getByRole('switch', { name: 'Website' }));
    release();
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Fees' }).getAttribute('aria-checked')).toBe(
        'false',
      ),
    );
    if (bodies.length === 1) await user.click(screen.getByRole('switch', { name: 'Website' }));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]?.modules).toEqual({ fees: false });
  });

  it('a write without a code shows the step-up prompt, then goes through with the token', async () => {
    const tokens: (string | null)[] = [];
    server.use(
      globalRead({}),
      http.put('*/platform/modules', ({ request }) => {
        const token = request.headers.get('X-Approval-Token');
        tokens.push(token);
        return token
          ? HttpResponse.json({ modules: { fees: false } })
          : err(403, 'APPROVAL_REQUIRED');
      }),
    );
    const user = userEvent.setup();
    host(<GlobalModulesCard />);
    await user.click(await screen.findByRole('switch', { name: 'Fees' }));
    await user.click(screen.getByRole('button', { name: 'Turn off' }));
    await user.type(await screen.findByLabelText('Authenticator code'), '123456');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(tokens).toEqual([null, 'owner-token']));
  });

  it('a failure shows one fixed sentence, goes back, and is not retried', async () => {
    let calls = 0;
    server.use(
      globalRead({}),
      http.put('*/platform/modules', () => {
        calls += 1;
        return err(500);
      }),
    );
    const user = userEvent.setup();
    host(<GlobalModulesCard />);
    // The owner has no code prompt here: token-less 500 is a plain failure.
    await user.click(await screen.findByRole('switch', { name: 'Fees' }));
    await user.click(screen.getByRole('button', { name: 'Turn off' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Not saved. Try again.');
    expect(screen.queryByText(/leaky/)).toBeNull();
    expect(screen.getByRole('switch', { name: 'Fees' }).getAttribute('aria-checked')).toBe('true');
    await new Promise((r) => setTimeout(r, 300));
    expect(calls).toBe(1);
  });

  it('shows an error state when the map cannot load', async () => {
    server.use(http.get('*/platform/modules', () => err(500)));
    host(<GlobalModulesCard />);
    expect(
      await screen.findByText('Could not load the modules.', {}, { timeout: 5000 }),
    ).toBeTruthy();
  });
});

describe('ModulesTab (lock card)', () => {
  it('shows the school choice and the lock, and greys a platform-off module', async () => {
    server.use(
      globalRead({ homework: false }),
      schoolRead({ fees: { on: false, lock: 'on' }, fines: { on: true } }),
    );
    host(<ModulesTab schoolId="s-1" />);
    const fees = (await screen.findByText('Fees')).closest('li')!;
    expect(within(fees).getByText('Your school: Off')).toBeTruthy();
    expect(within(fees).getByText('Platform locked')).toBeTruthy();
    const hw = screen.getByText('Homework').closest('li')!;
    expect(within(hw).getByText('Platform off')).toBeTruthy();
    expect(within(hw).getByRole('combobox').hasAttribute('disabled')).toBe(true);
    expect(
      within(screen.getByText('Syllabus').closest('li')!).getByText('Your school: not chosen yet'),
    ).toBeTruthy();
  });

  it('a lock change sends exactly {lock}, once', async () => {
    const bodies: unknown[] = [];
    server.use(
      globalRead({}),
      schoolRead({ fees: { lock: 'on' } }),
      http.put('*/platform/schools/:id/modules/:key/lock', async ({ request, params }) => {
        bodies.push([params.key, await request.json()]);
        return HttpResponse.json({});
      }),
    );
    const user = userEvent.setup();
    host(<ModulesTab schoolId="s-1" />);
    await user.click(await screen.findByRole('combobox', { name: 'Lock for Attendance' }));
    await user.click(await screen.findByRole('option', { name: 'Locked On' }));
    await waitFor(() => expect(bodies).toEqual([['attendance', { lock: 'on' }]]));
    await user.click(screen.getByRole('combobox', { name: 'Lock for Fees' }));
    await user.click(await screen.findByRole('option', { name: 'No lock' }));
    await waitFor(() => expect(bodies[1]).toEqual(['fees', { lock: null }]));
    expect(bodies).toHaveLength(2);
  });

  it('a failed lock change reverts the select, says why, and is not retried', async () => {
    let calls = 0;
    server.use(
      globalRead({}),
      schoolRead({}),
      http.put('*/platform/schools/:id/modules/:key/lock', () => {
        calls += 1;
        return err(500);
      }),
    );
    const user = userEvent.setup();
    host(<ModulesTab schoolId="s-1" />);
    const select = await screen.findByRole('combobox', { name: 'Lock for Attendance' });
    await user.click(select);
    await user.click(await screen.findByRole('option', { name: 'Locked Off' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Not saved. Try again.');
    expect(select.textContent).toContain('No lock');
    await new Promise((r) => setTimeout(r, 300));
    expect(calls).toBe(1);
  });

  it('shows an error state when a read fails', async () => {
    server.use(
      globalRead({}),
      http.get('*/platform/schools/:id/modules', () => err(500)),
    );
    host(<ModulesTab schoolId="s-1" />);
    expect(
      await screen.findByText('Could not load the modules.', {}, { timeout: 5000 }),
    ).toBeTruthy();
  });
});

describe('module strings', () => {
  it('en and bn carry the same keys', () => {
    expect(Object.keys(bn.modules.lock).sort()).toEqual(Object.keys(en.modules.lock).sort());
    expect(Object.keys(bn.modules.global).sort()).toEqual(Object.keys(en.modules.global).sort());
    expect(bn.tabs.modules).toBeTruthy();
  });
});
