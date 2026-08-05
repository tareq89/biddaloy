import { useQuery } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { getAccessToken, getActiveRole, getActiveTenant } from '../api/auth-state';

import { createTestQueryClient, renderWithProviders } from './render-with-providers';

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

function QueryProbe({ queryKey }: { queryKey: readonly unknown[] }) {
  const { data, status } = useQuery({
    queryKey,
    queryFn: () => Promise.reject(new Error('should not be called — data is seeded')),
  });
  return <p>{status === 'success' ? String(data) : status}</p>;
}

function FailingQuery() {
  const { status } = useQuery({
    queryKey: ['always-fails'],
    queryFn: () => Promise.reject(new Error('boom')),
  });
  return <p>{status}</p>;
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
  // and the module-level `afterEach(clearAuthState)` should have run
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
    renderWithProviders(<QueryProbe queryKey={['seeded']} />, {
      seedQueries: [{ queryKey: ['seeded'], data: 'from cache' }],
    });
    await waitFor(() => expect(screen.getByText('from cache')).toBeTruthy());
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
});
