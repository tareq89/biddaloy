import { render as rtlRender, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { I18nProvider, i18n, whenReady } from '../i18n';

import { MultiCombobox, type MultiComboboxOption } from './multi-combobox';

const OPTIONS: MultiComboboxOption[] = [
  { value: 'six', label: 'Six' },
  { value: 'seven', label: 'Seven' },
  { value: 'eight', label: 'Eight' },
  { value: 'bn8', label: 'শ্রেণি ৮' },
];

function Controlled({ initial = [], max }: { initial?: string[]; max?: number }) {
  const [value, setValue] = useState<string[]>(initial);
  return (
    <MultiCombobox
      aria-label="Class"
      options={OPTIONS}
      value={value}
      onValueChange={setValue}
      placeholder="Search…"
      max={max}
    />
  );
}

const render = (ui: ReactElement) => rtlRender(ui, { wrapper: I18nProvider });

beforeEach(async () => {
  await whenReady(i18n);
  await i18n.changeLanguage('en');
});

describe('MultiCombobox', () => {
  it('has the combobox role and a multiselectable listbox', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const input = screen.getByRole('combobox', { name: 'Class' });
    await user.click(input);
    expect(screen.getByRole('listbox').getAttribute('aria-multiselectable')).toBe('true');
  });

  it('Enter toggles the active option on and off and keeps the list open', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.click(screen.getByRole('combobox'));
    await user.keyboard('{ArrowDown}{Enter}');
    expect(screen.getByRole('button', { name: 'Remove Six' })).toBeTruthy();
    expect(screen.getByRole('listbox')).toBeTruthy();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('button', { name: 'Remove Six' })).toBeNull();
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('clicking an option adds a chip; removing it returns focus to the input', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.click(screen.getByRole('option', { name: 'Six' }));
    await user.click(screen.getByRole('button', { name: 'Remove Six' }));
    expect(screen.queryByRole('button', { name: 'Remove Six' })).toBeNull();
    expect(document.activeElement).toBe(input);
  });

  it('Backspace on an empty input removes the last chip', async () => {
    const user = userEvent.setup();
    render(<Controlled initial={['six', 'seven']} />);
    await user.click(screen.getByRole('combobox'));
    await user.keyboard('{Backspace}');
    expect(screen.queryByRole('button', { name: 'Remove Seven' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove Six' })).toBeTruthy();
  });

  it('at max, unselected options are aria-disabled and Enter does nothing', async () => {
    const user = userEvent.setup();
    render(<Controlled initial={['six']} max={1} />);
    await user.click(screen.getByRole('combobox'));
    expect(screen.getByRole('option', { name: 'Seven' }).getAttribute('aria-disabled')).toBe(
      'true',
    );
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(screen.queryByRole('button', { name: 'Remove Seven' })).toBeNull();
  });

  it('announces the filtered count and matches Bangla digits by Latin digits', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.click(screen.getByRole('combobox'));
    await user.keyboard('8');
    expect(screen.getByText('1 result')).toBeTruthy();
    expect(screen.getByRole('option', { name: 'শ্রেণি ৮' })).toBeTruthy();
  });
});
