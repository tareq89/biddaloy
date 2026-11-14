import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PackageListView, type PackageListViewProps } from './package-list-view';

const pkg = (id: string, name: string, active: boolean) => ({
  id,
  name,
  smsCount: 5000,
  validityDays: 180,
  pricePaisa: '150000',
  priceTaka: '1500.00',
  active,
});

const view = (over: Partial<PackageListViewProps> = {}) => {
  const props: PackageListViewProps = {
    packages: [pkg('1', 'Big', true), pkg('2', 'Old', false)],
    onRetry: vi.fn(),
    onNew: vi.fn(),
    onRecordStock: vi.fn(),
    onEdit: vi.fn(),
    onToggle: vi.fn(),
    ...over,
  };
  renderWithProviders(<PackageListView {...props} />, {
    locale: 'en',
    role: 'SUPER_ADMIN',
    tenantId: 'platform',
  });
  return props;
};

afterEach(async () => {
  await cleanupTestState();
});

describe('PackageListView', () => {
  it('shows on and off state without opening a row, and the old-orders note', async () => {
    view();
    const on = await screen.findByRole('switch', { name: 'Offer Big to schools' });
    expect(on.getAttribute('aria-checked')).toBe('true');
    expect(
      screen.getByRole('switch', { name: 'Offer Old to schools' }).getAttribute('aria-checked'),
    ).toBe('false');
    expect(screen.getByText('Schools who already bought keep what they bought.')).toBeTruthy();
  });

  it('calls the switch handler once with the new state', async () => {
    const user = userEvent.setup();
    const props = view();
    await user.click(await screen.findByRole('switch', { name: 'Offer Old to schools' }));
    expect(props.onToggle).toHaveBeenCalledTimes(1);
    expect(props.onToggle).toHaveBeenCalledWith(expect.objectContaining({ id: '2' }), true);
  });

  it('opens edit, new and record-stock', async () => {
    const user = userEvent.setup();
    const props = view();
    await user.click((await screen.findAllByRole('button', { name: 'Edit' }))[0]!);
    await user.click(screen.getByRole('button', { name: 'New SMS package' }));
    await user.click(screen.getByRole('button', { name: 'Record SMS bought' }));
    expect(props.onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }));
    expect(props.onNew).toHaveBeenCalledTimes(1);
    expect(props.onRecordStock).toHaveBeenCalledTimes(1);
  });

  it('shows the empty state', async () => {
    view({ packages: [] });
    expect(await screen.findByText('No SMS packages yet')).toBeTruthy();
  });

  it('shows a retry on error', async () => {
    const user = userEvent.setup();
    const props = view({ error: true });
    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(props.onRetry).toHaveBeenCalledTimes(1);
  });
});
