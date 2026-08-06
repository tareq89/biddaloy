import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { REGION_BD_EN } from '../utils/region-config';

import { formatValidPhone, PhoneInput } from './phone-input';

function Controlled() {
  const [value, setValue] = useState('');
  return (
    <PhoneInput
      aria-label="Phone"
      value={value}
      onValueChange={(v) => setValue(v)}
      config={REGION_BD_EN}
    />
  );
}

describe('PhoneInput', () => {
  it("shows the region's own example as a placeholder", () => {
    render(<Controlled />);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- tsc disagrees with eslint's type resolution here; the cast is required for `.placeholder` to typecheck under `tsc --noEmit`.
    const input = screen.getByRole('textbox', { name: 'Phone' }) as HTMLInputElement;
    expect(input.placeholder).toBe('1712-345678');
  });

  it('is not marked invalid while empty', () => {
    render(<Controlled />);
    expect(screen.getByRole('textbox', { name: 'Phone' }).getAttribute('aria-invalid')).toBe(
      'false',
    );
  });

  it('marks a valid national number as not invalid', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const input = screen.getByRole('textbox', { name: 'Phone' });
    await user.type(input, '1712345678');
    expect(input.getAttribute('aria-invalid')).toBe('false');
  });

  it('marks an invalid number as aria-invalid rather than silently accepting it', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const input = screen.getByRole('textbox', { name: 'Phone' });
    await user.type(input, '9912345678');
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('is axe clean with a labelled, currently-valid value', async () => {
    const user = userEvent.setup();
    const { container } = render(<Controlled />);
    await user.type(screen.getByRole('textbox', { name: 'Phone' }), '1712345678');
    await expect(container).toHaveNoViolations();
  });
});

describe('formatValidPhone', () => {
  it('formats a valid national number for read-only display', () => {
    expect(formatValidPhone('1712345678', REGION_BD_EN)).toBe('+880 1712-345678');
  });

  it('throws on an invalid number rather than silently mangling it', () => {
    expect(() => formatValidPhone('123', REGION_BD_EN)).toThrow(RangeError);
  });
});
