import '@biddaloy/ui/test';

import { recordFreshness } from '@biddaloy/ui/api';
import { HelpProvider, WidgetCard } from '@biddaloy/ui/components';
import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { retryableLazy } from '../widgets/registry';

import { WidgetSlot } from './widget-slot';

const OK = 'widget ok';
const ROUTE_BOUNDARY = 'route boundary';
let shouldThrow = true;
function Bomb() {
  if (shouldThrow) throw new Error('boom');
  return <p>{OK}</p>;
}

describe('WidgetSlot', () => {
  afterEach(async () => {
    shouldThrow = true;
    vi.restoreAllMocks();
    await cleanupTestState();
  });

  it('shows ErrorState and Retry remounts only the child', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderWithProviders(
      <WidgetSlot size="M">
        <Bomb />
      </WidgetSlot>,
      { locale: 'en' },
    );
    expect(await screen.findByRole('alert')).toBeTruthy();
    shouldThrow = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(OK)).toBeTruthy();
  });

  it('shows the saved-data notice for sw-cache freshness, none for network', async () => {
    recordFreshness(['dashboard', 'widget', 'upcoming'], {
      fetchedAt: Date.now() - 3 * 3_600_000,
      source: 'sw-cache',
    });
    recordFreshness(['dashboard', 'widget', 'sms-balance'], {
      fetchedAt: Date.now(),
      source: 'network',
    });
    renderWithProviders(
      <>
        <WidgetSlot size="S" widgetKey="upcoming">
          <p data-testid="a" />
        </WidgetSlot>
        <WidgetSlot size="S" widgetKey="sms-balance">
          <p data-testid="b" />
        </WidgetSlot>
      </>,
      { locale: 'en' },
    );
    expect(await screen.findAllByText(/saved data/i)).toHaveLength(1);
  });

  it('lets a tenant-suspended error propagate to the route boundary', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function Suspended(): React.ReactNode {
      throw Object.assign(new Error('suspended'), {
        statusCode: 403,
        details: { code: 'TENANT_SUSPENDED' },
      });
    }
    class Catch extends React.Component<{ children: React.ReactNode }, { caught: boolean }> {
      override state = { caught: false };
      static getDerivedStateFromError() {
        return { caught: true };
      }
      override render() {
        return this.state.caught ? <p data-testid="route-boundary" /> : this.props.children;
      }
    }
    renderWithProviders(
      <Catch>
        <WidgetSlot size="M">
          <Suspended />
        </WidgetSlot>
      </Catch>,
      { locale: 'en' },
    );
    expect(screen.getByTestId('route-boundary')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a per-size skeleton while a lazy child is pending', () => {
    const Pending = React.lazy(() => new Promise<never>(() => undefined));
    const { container } = renderWithProviders(
      <WidgetSlot size="L">
        <Pending />
      </WidgetSlot>,
      { locale: 'en' },
    );
    expect(container.querySelector('[data-slot="widget-skeleton"]')?.className).toContain('h-64');
  });

  // React.lazy caches a rejected import; a plain lazy would rethrow forever.
  it('re-imports a widget whose chunk failed to load instead of rethrowing the cached error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('chunk 404'))
      .mockResolvedValue({ default: () => <p>{OK}</p> });
    const Widget = retryableLazy(load);
    renderWithProviders(
      <WidgetSlot size="M">
        <Widget variant="full" size="M" />
      </WidgetSlot>,
      { locale: 'en' },
    );
    expect(await screen.findByText(OK)).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('passes TENANT_SUSPENDED up to the route boundary instead of showing a card error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function Suspended(): React.ReactNode {
      throw Object.assign(new Error('This school has been suspended'), {
        statusCode: 403,
        details: { code: 'TENANT_SUSPENDED', reason: 'TRIAL_EXPIRED' },
      });
    }
    class Outer extends React.Component<{ children: React.ReactNode }, { caught: boolean }> {
      override state = { caught: false };
      static getDerivedStateFromError() {
        return { caught: true };
      }
      override render() {
        return this.state.caught ? <p>{ROUTE_BOUNDARY}</p> : this.props.children;
      }
    }
    renderWithProviders(
      <Outer>
        <WidgetSlot size="M">
          <Suspended />
        </WidgetSlot>
      </Outer>,
      { locale: 'en' },
    );
    expect(screen.getByText(ROUTE_BOUNDARY)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('gives the card a (?) with id widget.<key> through context', async () => {
    renderWithProviders(
      <HelpProvider
        lang="en"
        baseUrl="https://guide.test"
        index={{
          'widget.upcoming': {
            title: { bn: 'আসন্ন', en: 'Upcoming' },
            summary: { bn: 's', en: 's' },
            path: 'dashboard/widgets',
            anchor: 'widget.upcoming',
            knownIssues: 0,
          },
        }}
      >
        <WidgetSlot size="S" widgetKey="upcoming">
          <WidgetCard title={OK} />
        </WidgetSlot>
      </HelpProvider>,
      { locale: 'en' },
    );
    const btn = await screen.findByRole('button', { name: `Help: ${OK}` });
    expect(btn.getAttribute('data-help-id')).toBe('widget.upcoming');
  });
});
