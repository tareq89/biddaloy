import '@biddaloy/ui/test';

import {
  ROLE_DEFAULT_LAYOUTS,
  UserRole,
  WIDGET_CATALOGUE,
  type DashboardLayoutPref,
} from '@biddaloy/shared';
import { toast } from '@biddaloy/ui/components';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CustomiseMode } from './customise-mode';

const onDone = vi.fn();
let bodies: DashboardLayoutPref[] = [];

function mockApi(patchStatus = 200) {
  bodies = [];
  server.use(
    http.get('/api/v1/users/me', () => HttpResponse.json({ id: 'u1', preferences: null })),
    http.patch('/api/v1/users/me/preferences/dashboard', async ({ request }) => {
      const body = (await request.json()) as DashboardLayoutPref;
      bodies.push(body);
      return patchStatus === 200
        ? HttpResponse.json(body)
        : HttpResponse.json({ message: 'Too many widgets' }, { status: patchStatus });
    }),
  );
}

const render = () =>
  renderWithProviders(<CustomiseMode role={UserRole.EXECUTIVE} onDone={onDone} />, {
    locale: 'en',
    role: 'EXECUTIVE',
    tenantId: 'tenant-1',
  });
// needsEpic widgets without a widget file are off (D42, D51). List here each one turned on.
const TURNED_ON = new Set<string>(['approvals-pending']);
const exec = ROLE_DEFAULT_LAYOUTS.EXECUTIVE.filter(
  (k) => !WIDGET_CATALOGUE[k].needsEpic || TURNED_ON.has(k),
);

describe('CustomiseMode', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    onDone.mockClear();
    await cleanupTestState();
  });

  it('shows the badge, intro and live summary counts', async () => {
    mockApi();
    render();
    expect(await screen.findByText('Customising')).toBeTruthy();
    expect(screen.getByText(/Choose which widgets show/)).toBeTruthy();
    const total = exec.length;
    expect(
      screen.getByText(`${total} widgets for Academic coordinator, ${total} shown now.`),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole('checkbox', { name: /Student attendance today/ }));
    expect(
      screen.getByText(`${total} widgets for Academic coordinator, ${total - 1} shown now.`),
    ).toBeTruthy();
  });

  it('Save sends the draft, toasts and leaves customise mode', async () => {
    mockApi();
    const success = vi.spyOn(toast, 'success').mockImplementation(() => 1);
    render();
    await userEvent.click(
      await screen.findByRole('checkbox', { name: /Student attendance today/ }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(success).toHaveBeenCalledWith('Dashboard saved');
    expect(bodies).toHaveLength(1);
    const first = bodies[0]!.widgets.find((w) => w.key === 'attendance-today');
    expect(first?.hidden).toBe(true);
  });

  it('Enter in the panel saves', async () => {
    mockApi();
    vi.spyOn(toast, 'success').mockImplementation(() => 1);
    render();
    (await screen.findByRole('checkbox', { name: /Student attendance today/ })).focus();
    await userEvent.keyboard('{Enter}');
    await vi.waitFor(() => expect(bodies).toHaveLength(1));
  });

  it('Reset then Save sends the role default', async () => {
    mockApi();
    vi.spyOn(toast, 'success').mockImplementation(() => 1);
    render();
    await userEvent.click(
      await screen.findByRole('checkbox', { name: /Student attendance today/ }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Reset to default' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]!.widgets.map((w) => w.key)).toEqual(exec);
    expect(bodies[0]!.widgets.some((w) => w.hidden)).toBe(false);
  });

  it('Cancel and Escape leave without a request', async () => {
    mockApi();
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(onDone).toHaveBeenCalledTimes(1);
    (await screen.findByRole('checkbox', { name: /Student attendance today/ })).focus();
    await userEvent.keyboard('{Escape}');
    expect(onDone).toHaveBeenCalledTimes(2);
    expect(bodies).toHaveLength(0);
  });

  it('a 400 from the server shows the error and stays in customise mode', async () => {
    mockApi(400);
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });
});
