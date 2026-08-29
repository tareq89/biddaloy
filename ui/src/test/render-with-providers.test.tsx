import { useMutation, useQuery } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { getAccessToken, getActiveRole, getActiveTenant } from '../api/auth-state';
import { i18n } from '../i18n/i18n';
import { DEFAULT_LOCALE, getPersistedLocale, persistLocale } from '../i18n/locale-storage';

import {
  cleanupTestState,
  createTestQueryClient,
  renderWithProviders,
} from './render-with-providers';

function Greeting() {
  return <p>hello</p>;
}

function Counter() {
  const [count, setCount] = useState(0);
  return (
    <button type="button" onClick={() => setCount((c) => c + 1)}>
      count: {count}
    </button>
  );
}

function AuthProbe() {
  return (
    <dl>
      <dt>tenant</dt>
      <dd>{getActiveTenant() ?? 'none'}</dd>
      <dt>role</dt>
      <dd>{getActiveRole() ?? 'none'}</dd>
      <dt>token</dt>
      <dd>{getAccessToken() ?? 'none'}</dd>
    </dl>
  );
}

function QueryProbe({
  queryKey,
  queryFn,
}: {
  queryKey: readonly unknown[];
  queryFn: () => Promise<unknown>;
}) {
  const { data, status } = useQuery({ queryKey, queryFn });
  return <p>{status === 'success' ? String(data) : status}</p>;
}

function FailingQuery() {
  const { status } = useQuery({
    queryKey: ['always-fails'],
    queryFn: () => Promise.reject(new Error('boom')),
  });
  return <p>{status}</p>;
}

function SaveButton() {
  const { mutate, status } = useMutation({
    mutationFn: (name: string) => Promise.resolve(`saved:${name}`),
  });
  return (
    <button type="button" onClick={() => mutate('example')}>
      {status === 'success' ? 'saved' : 'save'}
    </button>
  );
}

describe('renderWithProviders', () => {
  it('works with zero configuration', () => {
    renderWithProviders(<Greeting />);
    expect(screen.getByText('hello')).toBeTruthy();
  });

  it('overrides tenant, role and access token via options', () => {
    renderWithProviders(<AuthProbe />, {
      tenantId: 'tenant-1',
      role: 'teacher',
      accessToken: 'token-abc',
    });
    expect(screen.getByText('tenant-1')).toBeTruthy();
    expect(screen.getByText('teacher')).toBeTruthy();
    expect(screen.getByText('token-abc')).toBeTruthy();
  });

  // Relies on this describe block's default sequential execution (vitest
  // doesn't run `it` blocks concurrently unless explicitly configured) —
  // the previous test set tenant-1/teacher/token-abc via renderWithProviders,
  // and ui/src/test/setup.ts's afterEach(cleanupTestState) should have run
  // between that test and this one. If it didn't, these would still show
  // the previous test's values instead of the "none" defaults.
  it('clears auth state between tests — no bleed from the previous test', () => {
    renderWithProviders(<AuthProbe />);
    expect(screen.getByText('tenant')).toBeTruthy();
    expect(screen.getAllByText('none')).toHaveLength(3);
  });

  it('gives each call a fresh QueryClient by default — no cross-test cache bleed', () => {
    const first = renderWithProviders(<Greeting />);
    const second = renderWithProviders(<Greeting />);
    expect(first.queryClient).not.toBe(second.queryClient);
  });

  it('seeds query data so a component reads it without ever fetching', async () => {
    const queryFn = vi.fn(() => Promise.reject(new Error('should not be called — data is seeded')));
    renderWithProviders(<QueryProbe queryKey={['seeded']} queryFn={queryFn} />, {
      seedQueries: [{ queryKey: ['seeded'], data: 'from cache' }],
    });
    await waitFor(() => expect(screen.getByText('from cache')).toBeTruthy());
    expect(queryFn).not.toHaveBeenCalled();
  });

  it('disables retries — a failing query settles as "error" on the first attempt', async () => {
    renderWithProviders(<FailingQuery />);
    await waitFor(() => expect(screen.getByText('error')).toBeTruthy());
  });

  it('re-exports a pre-configured userEvent that drives real interactions', async () => {
    const { user } = renderWithProviders(<Counter />);
    const button = screen.getByRole('button');
    expect(button.textContent).toBe('count: 0');
    await user.click(button);
    expect(button.textContent).toBe('count: 1');
  });

  it('accepts a caller-supplied QueryClient instead of creating one', () => {
    const queryClient = createTestQueryClient();
    const { queryClient: returned } = renderWithProviders(<Greeting />, { queryClient });
    expect(returned).toBe(queryClient);
  });

  it('supports mutations through the same provider stack', async () => {
    const { user } = renderWithProviders(<SaveButton />);
    const button = screen.getByRole('button');
    expect(button.textContent).toBe('save');
    await user.click(button);
    // Scoped to the button that was clicked, not the whole document.
    await within(button).findByText('saved');
  });

  describe('locale', () => {
    it('settles localeReady once the requested language is actually active', async () => {
      const { localeReady } = renderWithProviders(<Greeting />, { locale: 'en' });

      await localeReady;

      // The point of the handle: after awaiting it, a *synchronous* read
      // of the active language is already correct, with no waitFor.
      expect(i18n.language).toBe('en');
    });

    it('resolves localeReady immediately when no locale was requested', async () => {
      const { localeReady } = renderWithProviders(<Greeting />);

      await expect(localeReady).resolves.toBeUndefined();
    });

    it('cleanupTestState restores both the active language and the persisted key', async () => {
      const { localeReady } = renderWithProviders(<Greeting />, { locale: 'en' });
      await localeReady;
      expect(getPersistedLocale()).toBe('en');

      await cleanupTestState();

      expect(i18n.language).toBe(DEFAULT_LOCALE);
      // The half the old guarded reset left behind — a leftover key here
      // decides which language the next `createI18nInstance()` starts in.
      expect(getPersistedLocale()).toBe(DEFAULT_LOCALE);
    });

    it('clears a persisted locale that was written without moving the active language', async () => {
      // The case the old `i18n.language !== DEFAULT_LOCALE` guard missed
      // entirely: storage and the in-memory language are separate state,
      // and `locale-storage.test.ts` moves only the former.
      persistLocale('en');
      expect(i18n.language).toBe(DEFAULT_LOCALE);

      await cleanupTestState();

      expect(getPersistedLocale()).toBe(DEFAULT_LOCALE);
    });
  });
});
