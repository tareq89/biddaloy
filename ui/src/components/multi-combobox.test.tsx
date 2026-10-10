import { fireEvent, render as rtlRender, screen } from '@testing-library/react';
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

function Controlled({
  initial = [],
  max,
  options = OPTIONS,
  disabled,
  readOnly,
}: {
  initial?: string[];
  max?: number;
  options?: MultiComboboxOption[];
  disabled?: boolean;
  readOnly?: boolean;
}) {
  const [value, setValue] = useState<string[]>(initial);
  return (
    <MultiCombobox
      aria-label="Class"
      options={options}
      value={value}
      onValueChange={setValue}
      placeholder="Search…"
      max={max}
      disabled={disabled}
      readOnly={readOnly}
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

  it('keeps a chip label when options change under it (server-side search)', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Controlled />);
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: 'Six' }));
    rerender(<Controlled options={[{ value: 'seven', label: 'Seven' }]} />);
    expect(screen.getByRole('button', { name: 'Remove Six' })).toBeTruthy();
  });

  it('announces adding and removing a value', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: 'Six' }));
    expect(screen.getByText('Six added')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Remove Six' }));
    expect(screen.getByText('Six removed')).toBeTruthy();
  });

  it('disabled or readOnly: chip buttons are disabled and options do not toggle', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Controlled initial={['six']} disabled />);
    const removeSix = screen.getByRole('button', { name: 'Remove Six', hidden: true });
    expect((removeSix as HTMLButtonElement).disabled).toBe(true);

    rerender(<Controlled initial={['six']} readOnly />);
    await user.click(screen.getByRole('combobox'));
    // Nothing to pick, so the list stays closed even on focus and ArrowDown.
    await user.keyboard('{ArrowDown}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('combobox').getAttribute('aria-expanded')).toBe('false');
    await user.keyboard('{Backspace}');
    expect(screen.getByRole('button', { name: 'Remove Six', hidden: true })).toBeTruthy();
  });

  it('labels a chip from selectedOptions when its value is not in options', () => {
    render(
      <MultiCombobox
        aria-label="People"
        options={[]}
        selectedOptions={[{ value: 'x', label: 'Rahim' }]}
        value={['x']}
        onValueChange={() => {}}
      />,
    );
    expect(screen.getByText('Rahim')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove Rahim' })).toBeTruthy();
  });

  it('removing a chip with the mouse does not open the list', async () => {
    const user = userEvent.setup();
    render(<Controlled initial={['six']} />);
    await user.click(screen.getByRole('button', { name: 'Remove Six' }));
    expect(document.activeElement).toBe(screen.getByRole('combobox'));
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('a list reopened after Escape starts from the first option', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.click(screen.getByRole('combobox'));
    await user.keyboard('{ArrowDown}{ArrowDown}{Escape}{ArrowDown}{Enter}');
    expect(screen.getByRole('button', { name: 'Remove Six' })).toBeTruthy();
  });

  it('with no match, Enter is not swallowed and no missing option is active', async () => {
    const user = userEvent.setup();
    let submitted = 0;
    rtlRender(
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submitted += 1;
        }}
      >
        <Controlled />
      </form>,
      { wrapper: I18nProvider },
    );
    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.keyboard('zzz');
    expect(input.getAttribute('aria-activedescendant')).toBeNull();
    await user.keyboard('{Enter}');
    expect(submitted).toBe(1);
  });

  it('ignores Enter while an IME is composing', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.keyboard('{ArrowDown}');
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(screen.queryByRole('button', { name: 'Remove Six' })).toBeNull();
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
