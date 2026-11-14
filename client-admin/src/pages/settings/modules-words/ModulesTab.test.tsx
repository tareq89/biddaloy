import '@biddaloy/ui/test';
import type { PlatformModules, SchoolModules } from '@biddaloy/shared';
import { Toaster } from '@biddaloy/ui/components';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ModulesTab } from './ModulesTab';

const opts = { locale: 'en' as const, role: 'ADMIN' as const, tenantId: 'school-1' };

/** A profile whose modules block the test controls; PATCH bodies are recorded. */
function mockApi(modules: { platform?: PlatformModules; school?: SchoolModules } = {}) {
  let state = { platform: modules.platform ?? {}, school: modules.school ?? {} };
  const patch = vi.fn<(body: unknown) => void>();
  const profileGets = vi.fn();
  server.use(
    http.get('/api/v1/schools/me/profile', () => {
      profileGets();
      return HttpResponse.json({ name: 'S', slug: 's', modules: state, labels: {} });
    }),
    http.patch('/api/v1/schools/school-1/settings', async ({ request }) => {
      const body = (await request.json()) as { modules: SchoolModules };
      patch(body);
      state = { ...state, school: { ...state.school, ...body.modules } };
      return HttpResponse.json({ version: 1 });
    }),
  );
  return { patch, profileGets };
}

const renderTab = () =>
  renderWithProviders(
    <>
      <ModulesTab schoolId="school-1" />
      <Toaster />
    </>,
    opts,
  );
const row = (name: string) => screen.getByText(name).closest('li') as HTMLElement;

describe('ModulesTab', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders the four groups and one switch per module, none for core areas', async () => {
    mockApi();
    renderTab();

    expect(await screen.findByRole('heading', { name: 'Study' })).toBeTruthy();
    for (const g of ['Money', 'People', 'Communication']) {
      expect(screen.getByRole('heading', { name: g })).toBeTruthy();
    }
    expect(screen.getAllByRole('switch')).toHaveLength(17);
    expect(screen.queryByText('Students')).toBeNull();
    expect(screen.queryByText('Settings')).toBeNull();
  });

  it('turning a module off sends one PATCH, shows an Undo toast, then refetches the profile', async () => {
    const { patch, profileGets } = mockApi();
    renderTab();
    await userEvent.click(await screen.findByRole('switch', { name: 'Homework' }));

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch).toHaveBeenCalledWith({ version: 1, modules: { homework: { on: false } } });
    expect(await screen.findByText('Homework turned Off')).toBeTruthy();
    await waitFor(() => expect(profileGets.mock.calls.length).toBeGreaterThanOrEqual(2));
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Homework' }).getAttribute('aria-checked')).toBe(
        'false',
      ),
    );
  });

  it('Undo sends the reverse PATCH', async () => {
    const { patch } = mockApi();
    renderTab();
    await userEvent.click(await screen.findByRole('switch', { name: 'Homework' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(2));
    expect(patch).toHaveBeenLastCalledWith({ version: 1, modules: { homework: { on: true } } });
  });

  it('a failed save reverts the switch, says so on the row and does not retry', async () => {
    mockApi();
    const calls = vi.fn();
    server.use(
      http.patch('/api/v1/schools/school-1/settings', () => {
        calls();
        return HttpResponse.json(
          { statusCode: 400, message: 'no', requestId: 'r' },
          { status: 400 },
        );
      }),
    );
    renderTab();
    await userEvent.click(await screen.findByRole('switch', { name: 'Homework' }));

    const alert = await within(row('Homework')).findByRole('alert');
    expect(alert.textContent).toBe('Not saved — try again');
    expect(screen.getByRole('switch', { name: 'Homework' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    await new Promise((r) => setTimeout(r, 400));
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it('platform-off, platform-locked and dependency-off rows are shut, with the source note', async () => {
    mockApi({
      platform: { website: false },
      school: { messaging: { lock: 'on' }, fees: { on: false } },
    });
    renderTab();
    await screen.findByRole('switch', { name: 'Website' });

    const website = row('Website');
    expect(within(website).getByText('Platform turned it off')).toBeTruthy();
    expect(within(website).getByRole('switch').hasAttribute('disabled')).toBe(true);
    expect(within(website).getByRole('button', { name: "Who can't see it" })).toHaveProperty(
      'disabled',
      true,
    );

    const messaging = row('Messages and SMS');
    expect(
      within(messaging).getByText('This cannot be turned off. Platform locked it'),
    ).toBeTruthy();
    expect(within(messaging).getByRole('switch').hasAttribute('disabled')).toBe(true);

    const fines = row('Fines');
    expect(within(fines).getByText('Off because Fees is Off')).toBeTruthy();
    expect(within(fines).getByRole('switch').hasAttribute('disabled')).toBe(true);
    // Fees itself is the school's own choice and stays clickable.
    expect(within(row('Fees')).getByRole('switch').hasAttribute('disabled')).toBe(false);
  });

  it('the dialog saves offForRoles and never offers Admin', async () => {
    const { patch } = mockApi();
    renderTab();
    await screen.findByRole('switch', { name: 'Homework' });
    await userEvent.click(
      within(row('Homework')).getByRole('button', { name: "Who can't see it" }),
    );

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText('Admin')).toBeNull();
    expect(within(dialog).queryByText('Super admin')).toBeNull();
    expect(within(dialog).getByText('Admins can always see it.')).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Parent' }));
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Student' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch).toHaveBeenCalledWith({
      version: 1,
      modules: { homework: { offForRoles: ['PARENT', 'STUDENT'] } },
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByRole('button', { name: 'Hidden from 2 roles' })).toBeTruthy();
  });
});
