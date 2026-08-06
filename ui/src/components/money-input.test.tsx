import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { REGION_BD_BN, REGION_BD_EN, type RegionConfig } from '../utils/region-config';

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
});
