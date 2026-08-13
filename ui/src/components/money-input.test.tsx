import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { REGION_BD_BN, REGION_BD_EN, type RegionConfig } from '../i18n/region-config';

import { MoneyInput } from './money-input';

function getInput(): HTMLInputElement {
  return screen.getByRole('textbox', { name: 'Amount' });
}

function Controlled({
  config = REGION_BD_EN,
  initial,
}: {
  config?: RegionConfig;
  initial?: number;
}) {
  const [value, setValue] = useState<number | undefined>(initial);
  return <MoneyInput aria-label="Amount" value={value} onValueChange={setValue} config={config} />;
}

describe('MoneyInput', () => {
  it('displays the amount fully formatted — symbol, grouping and decimals', () => {
    render(<Controlled initial={12345600} />);
    expect(getInput().value).toBe('৳1,23,456.00');
  });

  it('is empty when the value is undefined', () => {
    render(<Controlled />);
    expect(getInput().value).toBe('');
  });

  it('parses Latin-digit typed input and commits the equivalent minor-unit amount on blur', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.type(getInput(), '500');
    await user.tab();
    // Round-trips through the commit -> re-render -> reformat cycle: 500
    // taka typed in becomes 50000 paisa, which formats back as ৳500.00.
    expect(getInput().value).toBe('৳500.00');
  });

  it('parses Bengali-digit typed input the same way under a Bengali-numeral config', async () => {
    const user = userEvent.setup();
    render(<Controlled config={REGION_BD_BN} />);
    await user.type(getInput(), '৫০০');
    await user.tab();
    expect(getInput().value).toBe('৳৫০০.০০');
  });

  it('clears to undefined when the field is emptied', async () => {
    const user = userEvent.setup();
    render(<Controlled initial={100} />);
    await user.clear(getInput());
    await user.tab();
    expect(getInput().value).toBe('');
  });

  it('leaves the last committed value alone while typing an interim, not-yet-valid amount', async () => {
    const user = userEvent.setup();
    render(<Controlled initial={12345600} />);
    const input = getInput();
    await user.clear(input);
    await user.type(input, '12.');
    // "12." (mid-typing a decimal) isn't a complete amount yet — the raw
    // text is shown as typed, not reformatted or rejected mid-keystroke.
    expect(input.value).toBe('12.');
  });

  it('reflects an external value change (e.g. form.reset()) while unfocused, per the controlled-component contract', async () => {
    function ResettableControlled() {
      const [value, setValue] = useState<number | undefined>(12345600);
      return (
        <div>
          <MoneyInput
            aria-label="Amount"
            value={value}
            onValueChange={setValue}
            config={REGION_BD_EN}
          />
          <button onClick={() => setValue(undefined)}>Reset</button>
        </div>
      );
    }
    const user = userEvent.setup();
    render(<ResettableControlled />);
    expect(getInput().value).toBe('৳1,23,456.00');

    // Never focused this input — a real `form.reset()` call from elsewhere
    // in the page, not a blur-triggered reformat.
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(getInput().value).toBe('');
  });

  it('does not fight the user mid-type — every keystroke round-trips through `value`, which is exactly the case the focus-guard exists for', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const input = getInput();
    await user.click(input);
    await user.type(input, '500');
    // Each digit commits a new `value` (5 -> 50 -> 500 paisa) and re-renders
    // with that prop — the field must still show what was typed, not a
    // reformatted amount one keystroke behind.
    expect(input.value).toBe('500');
  });

  it('flags an invalid amount left on blur with aria-invalid instead of silently discarding it', async () => {
    const user = userEvent.setup();
    render(<Controlled initial={12345600} />);
    const input = getInput();
    expect(input.getAttribute('aria-invalid')).toBeNull();

    await user.clear(input);
    await user.type(input, '12.');
    await user.tab();

    expect(input.getAttribute('aria-invalid')).toBe('true');
    // Left as typed, not silently reverted to the last committed amount.
    expect(input.value).toBe('12.');
  });

  it('clears a stale aria-invalid when an external value change replaces the invalid text', async () => {
    function ResettableControlled() {
      const [value, setValue] = useState<number | undefined>(12345600);
      return (
        <div>
          <MoneyInput
            aria-label="Amount"
            value={value}
            onValueChange={setValue}
            config={REGION_BD_EN}
          />
          <button onClick={() => setValue(5000)}>Set to ৳50.00</button>
        </div>
      );
    }
    const user = userEvent.setup();
    render(<ResettableControlled />);
    const input = getInput();

    await user.clear(input);
    await user.type(input, '12.');
    await user.tab();
    expect(input.getAttribute('aria-invalid')).toBe('true');

    // Never refocused the input — an external reset while it's blurred,
    // same as the `form.reset()` case above, just with a leftover parse
    // error in play this time.
    await user.click(screen.getByRole('button', { name: 'Set to ৳50.00' }));
    expect(input.value).toBe('৳50.00');
    expect(input.getAttribute('aria-invalid')).toBeNull();
  });

  it('still calls a caller-supplied onFocus/onBlur alongside its own internal handling', async () => {
    const onFocus = vi.fn();
    const onBlur = vi.fn();
    const user = userEvent.setup();
    render(
      <MoneyInput
        aria-label="Amount"
        value={undefined}
        onValueChange={() => {}}
        config={REGION_BD_EN}
        onFocus={onFocus}
        onBlur={onBlur}
      />,
    );
    await user.click(getInput());
    expect(onFocus).toHaveBeenCalledTimes(1);
    await user.tab();
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it('clears aria-invalid once a valid amount is committed after a prior invalid blur', async () => {
    const user = userEvent.setup();
    render(<Controlled initial={12345600} />);
    const input = getInput();

    await user.clear(input);
    await user.type(input, '12.');
    await user.tab();
    expect(input.getAttribute('aria-invalid')).toBe('true');

    await user.click(input);
    await user.type(input, '5');
    await user.tab();
    expect(input.getAttribute('aria-invalid')).toBeNull();
  });
});
