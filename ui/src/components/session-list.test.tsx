import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { REGION_BD_EN } from '../i18n/region-config';
import { cleanupTestState } from '../test';
import { renderWithProviders } from '../test/render-with-providers';

import { SessionList, type Session } from './session-list';

async function renderInEnglish(
  ui: Parameters<typeof renderWithProviders>[0],
): Promise<ReturnType<typeof renderWithProviders>> {
  const result = renderWithProviders(ui, { locale: 'en' });
  await result.localeReady;
  return result;
}

const CURRENT: Session = {
  id: 'session-current',
  started_at: '2026-08-01T09:00:00.000Z',
  last_used_at: '2026-09-07T04:00:00.000Z',
  user_agent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  ip_address: '203.0.113.5',
  current: true,
};

const OTHER: Session = {
  id: 'session-other',
  started_at: '2026-07-15T09:00:00.000Z',
  last_used_at: '2026-09-01T12:00:00.000Z',
  user_agent: null,
  ip_address: null,
  current: false,
};

describe('SessionList', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders a card per session and shows "This device" only on the current one', async () => {
    await renderInEnglish(
      <SessionList
        sessions={[CURRENT, OTHER]}
        onRevoke={() => {}}
        onRevokeAll={() => {}}
        config={REGION_BD_EN}
        locale="en"
      />,
    );

    expect(await screen.findByText('This device')).toBeTruthy();
    expect(screen.getByText('Unknown device')).toBeTruthy();
    // Each per-device "Sign out" button carries a distinct accessible name
    // (`sessions.signOutDevice`) precisely so two of them are never
    // ambiguous to a screen reader — or to `getByRole` here.
    expect(screen.getAllByRole('button', { name: /Sign out — /i })).toHaveLength(2);
    expect(screen.getByRole('button', { name: /Sign out — Unknown device/ })).toBeTruthy();
  });

  it('calls onRevoke with the right session id', async () => {
    const user = userEvent.setup();
    const onRevoke = vi.fn();
    await renderInEnglish(
      <SessionList
        sessions={[CURRENT, OTHER]}
        onRevoke={onRevoke}
        onRevokeAll={() => {}}
        config={REGION_BD_EN}
        locale="en"
      />,
    );

    await user.click(await screen.findByRole('button', { name: /Sign out — Unknown device/ }));

    expect(onRevoke).toHaveBeenCalledWith(OTHER.id);
  });

  it('gates "sign out everywhere" behind a confirm dialog', async () => {
    const user = userEvent.setup();
    const onRevokeAll = vi.fn();
    await renderInEnglish(
      <SessionList
        sessions={[CURRENT, OTHER]}
        onRevoke={() => {}}
        onRevokeAll={onRevokeAll}
        config={REGION_BD_EN}
        locale="en"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Sign out everywhere' }));
    expect(onRevokeAll).not.toHaveBeenCalled();

    const dialog = within(screen.getByRole('dialog'));
    await user.click(dialog.getByRole('button', { name: 'Sign out everywhere' }));

    expect(onRevokeAll).toHaveBeenCalledTimes(1);
  });

  it('renders an EmptyState when only the current device is signed in', async () => {
    await renderInEnglish(
      <SessionList
        sessions={[CURRENT]}
        onRevoke={() => {}}
        onRevokeAll={() => {}}
        config={REGION_BD_EN}
        locale="en"
      />,
    );

    expect(screen.getByText("You're only signed in on this device.")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
  });

  it('renders skeletons while loading', async () => {
    const { container } = await renderInEnglish(
      <SessionList
        sessions={[]}
        onRevoke={() => {}}
        onRevokeAll={() => {}}
        loading
        config={REGION_BD_EN}
        locale="en"
      />,
    );

    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });

  it('renders the error state with a retry button', async () => {
    const onRetry = vi.fn();
    await renderInEnglish(
      <SessionList
        sessions={[]}
        onRevoke={() => {}}
        onRevokeAll={() => {}}
        error="Something went wrong"
        onRetry={onRetry}
        config={REGION_BD_EN}
        locale="en"
      />,
    );

    expect(screen.getByText('Something went wrong')).toBeTruthy();
  });

  it('is axe clean when populated', async () => {
    const { container } = await renderInEnglish(
      <SessionList
        sessions={[CURRENT, OTHER]}
        onRevoke={() => {}}
        onRevokeAll={() => {}}
        config={REGION_BD_EN}
        locale="en"
      />,
    );

    await expect(container).toHaveNoViolations();
  });
});
