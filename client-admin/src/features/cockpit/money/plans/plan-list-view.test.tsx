import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PlanListView, type PlanListViewProps } from './plan-list-view';

const plan = (id: string, name: string, active: boolean, is_default = false) => ({
  id,
  name,
  unit_price_paisa: 1000,
  active,
  is_default,
});

const view = (over: Partial<PlanListViewProps> = {}) => {
  const props: PlanListViewProps = {
    plans: [plan('1', 'Standard', true, true), plan('2', 'Extra', true), plan('3', 'Old', false)],
    onRetry: vi.fn(),
    onNew: vi.fn(),
    onEdit: vi.fn(),
    onToggle: vi.fn(),
    ...over,
  };
  renderWithProviders(<PlanListView {...props} />, {
    locale: 'en',
    role: 'SUPER_ADMIN',
    tenantId: 'platform',
  });
  return props;
};

afterEach(async () => {
  await cleanupTestState();
});

describe('PlanListView', () => {
  it('the default plan cannot be switched off: it shows Default and no switch', async () => {
    view();
    expect(await screen.findByText('Default')).toBeTruthy();
    expect(screen.queryByRole('switch', { name: 'Keep Standard on' })).toBeNull();
    expect(screen.getByRole('switch', { name: 'Keep Extra on' })).toBeTruthy();
  });

  it('shows the price as taka and the next-order note', async () => {
    view();
    expect((await screen.findAllByText('৳১০.০০')).length).toBeGreaterThan(0);
    expect(screen.queryByText('1000')).toBeNull();
    expect(screen.getByText(/applies to the next order only/)).toBeTruthy();
  });

  it('calls the switch handler once with the new state', async () => {
    const user = userEvent.setup();
    const props = view();
    await user.click(await screen.findByRole('switch', { name: 'Keep Old on' }));
    expect(props.onToggle).toHaveBeenCalledTimes(1);
    expect(props.onToggle).toHaveBeenCalledWith(expect.objectContaining({ id: '3' }), true);
  });

  it('opens edit and new', async () => {
    const user = userEvent.setup();
    const props = view();
    await user.click((await screen.findAllByRole('button', { name: 'Edit' }))[0]!);
    await user.click(screen.getByRole('button', { name: 'New plan' }));
    expect(props.onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }));
    expect(props.onNew).toHaveBeenCalledTimes(1);
  });

  it('shows the empty state', async () => {
    view({ plans: [] });
    expect(await screen.findByText('No plans yet')).toBeTruthy();
  });

  it('shows a retry on error', async () => {
    const user = userEvent.setup();
    const props = view({ error: true });
    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(props.onRetry).toHaveBeenCalledTimes(1);
  });
});
