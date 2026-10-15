import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WidgetSlot } from './widget-slot';

const OK = 'widget ok';
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
});
