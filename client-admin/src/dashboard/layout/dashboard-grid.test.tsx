import '@biddaloy/ui/test';

import { DashboardWidgetKey as K, type DashboardWidgetKey } from '@biddaloy/shared';
import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { WidgetProps } from '../widgets/registry';

import { DashboardGrid, SIZE_CLASS } from './dashboard-grid';

const fake = (key: string) =>
  function Fake({ variant }: WidgetProps) {
    return <p>{`${key}:${variant}`}</p>;
  };
const components = new Map<DashboardWidgetKey, React.ComponentType<WidgetProps>>([
  [K.ATTENDANCE_TODAY, fake('att')], // phoneTile, S
  [K.AT_RISK_STUDENTS, fake('risk')], // phoneTile, L
  [K.UPCOMING, fake('up')], // no tile
]);

const visible = [
  { key: K.ATTENDANCE_TODAY, size: 'S' as const },
  { key: K.AT_RISK_STUDENTS, size: 'L' as const },
  { key: K.UPCOMING, size: 'M' as const },
  { key: K.SMS_BALANCE, size: 'S' as const }, // no component yet
];

describe('DashboardGrid', () => {
  afterEach(cleanupTestState);

  it('maps sizes to span classes', async () => {
    expect(SIZE_CLASS.S).toBe('');
    expect(SIZE_CLASS.M).toBe('md:col-span-2');
    expect(SIZE_CLASS.L).toBe('md:col-span-2 xl:col-span-3');
    renderWithProviders(<DashboardGrid visible={visible} components={components} />, {
      locale: 'en',
    });
    const desktop = within(await screen.findByTestId('grid-desktop'));
    expect(desktop.getByText('up:full').parentElement?.className).toContain('md:col-span-2');
    expect(desktop.getByText('risk:full').parentElement?.className).toContain('xl:col-span-3');
  });

  it('skips a key with no component file and renders no error', () => {
    renderWithProviders(<DashboardGrid visible={visible} components={components} />, {
      locale: 'en',
    });
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(within(screen.getByTestId('grid-desktop')).queryAllByText(/^sms/)).toHaveLength(0);
  });

  it('phone: tiles for phoneTile keys only; an S tile has no compact card', () => {
    renderWithProviders(<DashboardGrid visible={visible} components={components} />, {
      locale: 'en',
    });
    const phone = within(screen.getByTestId('grid-phone'));
    expect(phone.getByText('att:tile')).toBeTruthy();
    expect(phone.getByText('risk:tile')).toBeTruthy();
    expect(phone.queryByText('up:tile')).toBeNull();
    expect(phone.queryByText('att:compact')).toBeNull();
    expect(phone.getByText('risk:compact')).toBeTruthy();
    expect(phone.getByText('up:compact')).toBeTruthy();
  });

  it('tapping an S tile expands its full card in place', async () => {
    renderWithProviders(<DashboardGrid visible={visible} components={components} />, {
      locale: 'en',
    });
    const tile = within(screen.getByTestId('grid-phone')).getByRole('button');
    expect(tile.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(tile);
    expect(tile.getAttribute('aria-expanded')).toBe('true');
    expect(within(screen.getByTestId('tile-expanded')).getByText('att:full')).toBeTruthy();
    await userEvent.click(tile);
    expect(screen.queryByTestId('tile-expanded')).toBeNull();
  });

  it('phone: a tile toggle has an accessible name while its widget chunk still loads', () => {
    const Pending = React.lazy(() => new Promise<never>(() => {}));
    renderWithProviders(
      <DashboardGrid
        visible={[{ key: K.COLLECTION_MONTH, size: 'S' as const }]}
        components={new Map([[K.COLLECTION_MONTH, Pending]])}
      />,
      { locale: 'en' },
    );
    const phone = within(screen.getByTestId('grid-phone'));
    // aria-labelledby points at the slot; the Suspense skeleton is its only content here.
    expect(phone.getByRole('button', { name: /^Loading \S/ }).getAttribute('aria-labelledby')).toBe(
      `tile-${K.COLLECTION_MONTH}`,
    );
  });

  it('phone: a tile that falls back to an interactive card is not nested in a button', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const Fallback = () => (
      <h2>
        <button type="button" title={undefined} />
      </h2>
    );
    renderWithProviders(
      <DashboardGrid
        visible={[{ key: K.ATTENDANCE_TODAY, size: 'S' as const }]}
        components={new Map([[K.ATTENDANCE_TODAY, Fallback]])}
      />,
      { locale: 'en' },
    );
    const phone = screen.getByTestId('grid-phone');
    expect(phone.querySelector('button button')).toBeNull();
    const nesting = err.mock.calls.filter((c) => String(c[0]).includes('cannot be a descendant'));
    err.mockRestore();
    expect(nesting).toHaveLength(0);
  });
});
