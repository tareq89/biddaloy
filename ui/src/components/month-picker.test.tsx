import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { RegionConfigProvider } from '../i18n';
import { REGION_BD_EN } from '../i18n/region-config';
import { renderWithProviders } from '../test';
import { formatMonth } from '../utils/date';

import { MonthPicker } from './month-picker';

function Controlled({
  initial,
  min,
  max,
  spy,
}: {
  initial?: string;
  min?: string;
  max?: string;
  spy?: (v: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <MonthPicker
      aria-label="Month"
      value={value}
      min={min}
      max={max}
      onValueChange={(v) => {
        spy?.(v);
        setValue(v);
      }}
    />
  );
}

async function setup(ui: React.ReactElement) {
  const view = renderWithProviders(
    <RegionConfigProvider value={REGION_BD_EN}>{ui}</RegionConfigProvider>,
    { locale: 'en' },
  );
  await view.localeReady;
}

const trigger = () => screen.getByRole('button', { name: 'Month' });

describe('MonthPicker', () => {
  it('shows the formatted value', async () => {
    await setup(<Controlled initial="2026-10" />);
    expect(trigger().textContent).toContain(formatMonth('2026-10', REGION_BD_EN));
  });

  it('shows the placeholder when empty', async () => {
    await setup(<Controlled />);
    expect(trigger().textContent).toContain('Pick a month');
  });

  it('choosing March calls onValueChange and closes', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    await setup(<Controlled initial="2026-10" spy={spy} />);
    await user.click(trigger());
    await user.click(await screen.findByRole('button', { name: 'March' }));
    expect(spy).toHaveBeenCalledWith('2026-03');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('prev/next year changes the header and the picked year', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    await setup(<Controlled initial="2026-10" spy={spy} />);
    await user.click(trigger());
    expect(await screen.findByText('2026')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Previous year' }));
    expect(screen.getByText('2025')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'January' }));
    expect(spy).toHaveBeenCalledWith('2025-01');
  });

  it('disables months outside min/max', async () => {
    const user = userEvent.setup();
    await setup(<Controlled initial="2026-10" min="2026-03" max="2026-09" />);
    await user.click(trigger());
    const btn = async (n: string) => await screen.findByRole('button', { name: n });
    expect(((await btn('February')) as HTMLButtonElement).disabled).toBe(true);
    expect(((await btn('March')) as HTMLButtonElement).disabled).toBe(false);
    expect(((await btn('September')) as HTMLButtonElement).disabled).toBe(false);
    expect(((await btn('October')) as HTMLButtonElement).disabled).toBe(true);
  });
});
