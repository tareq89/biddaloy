import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { OtpInput } from './otp-input';

function getInput(): HTMLInputElement {
  return screen.getByRole('textbox', { name: '6-digit code' });
}

function Controlled({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <OtpInput id="otp" aria-label="6-digit code" value={value} onValueChange={setValue} />;
}

describe('OtpInput', () => {
  it('is a single field, not six boxes', () => {
    render(<Controlled />);
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
  });

  it('accepts Latin digits typed directly', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.type(getInput(), '123456');
    expect(getInput().value).toBe('123456');
  });

  it('normalizes Bengali numerals to Latin digits', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.type(getInput(), '১২৩৪৫৬');
    expect(getInput().value).toBe('123456');
  });

  it('strips non-digit characters', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.type(getInput(), '12-34 56');
    expect(getInput().value).toBe('123456');
  });

  it('caps input at 6 digits', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.type(getInput(), '12345678');
    expect(getInput().value).toBe('123456');
  });

  it('marks itself invalid via aria-invalid', () => {
    render(
      <OtpInput id="otp" aria-label="6-digit code" value="" onValueChange={() => {}} invalid />,
    );
    expect(getInput().getAttribute('aria-invalid')).toBe('true');
  });

  it('is disabled when told to be', () => {
    render(
      <OtpInput id="otp" aria-label="6-digit code" value="" onValueChange={() => {}} disabled />,
    );
    expect(getInput().hasAttribute('disabled')).toBe(true);
  });

  it('is operable by keyboard alone', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.tab();
    expect(document.activeElement).toBe(getInput());
    await user.keyboard('654321');
    expect(getInput().value).toBe('654321');
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<Controlled />);
    await expect(container).toHaveNoViolations();
  });
});
