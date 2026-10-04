import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { RegionConfigProvider } from '../i18n';
import { REGION_BD_EN } from '../i18n/region-config';
import { renderWithProviders } from '../test';
import { formatTime } from '../utils/date';

import { TimeInput } from './time-input';

async function setup(props: Partial<React.ComponentProps<typeof TimeInput>>) {
  const onValueChange = vi.fn();
  const view = renderWithProviders(
    <RegionConfigProvider value={REGION_BD_EN}>
      <TimeInput aria-label="Start" value={undefined} onValueChange={onValueChange} {...props} />
    </RegionConfigProvider>,
    { locale: 'en' },
  );
  await view.localeReady;
  return onValueChange;
}

describe('TimeInput', () => {
  it('lists every step between min and max, labelled with formatTime', async () => {
    const user = userEvent.setup();
    await setup({ min: '07:00', max: '09:00' });
    await user.click(screen.getByRole('combobox', { name: 'Start' }));
    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(
      ['07:00', '07:30', '08:00', '08:30', '09:00'].map((v) => formatTime(v, REGION_BD_EN)),
    );
  });

  it('typing narrows the list and choosing calls onValueChange', async () => {
    const user = userEvent.setup();
    const spy = await setup({ min: '07:00', max: '09:00' });
    const input = screen.getByRole('combobox', { name: 'Start' });
    await user.click(input);
    await user.type(input, formatTime('08:30', REGION_BD_EN));
    const options = await screen.findAllByRole('option');
    expect(options.length).toBeLessThan(5);
    await user.click(screen.getByRole('option', { name: formatTime('08:30', REGION_BD_EN) }));
    expect(spy).toHaveBeenCalledWith('08:30');
  });

  it('shows an off-grid saved value', async () => {
    await setup({ value: '08:10' });
    expect(screen.getByRole('combobox', { name: 'Start' }).value).toBe(
      formatTime('08:10', REGION_BD_EN),
    );
  });
});
