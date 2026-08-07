import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Input } from './input';

describe('Input', () => {
  it('renders and is axe clean when given an accessible name', async () => {
    const { container } = render(<Input aria-label="Student name" />);
    expect(screen.getByRole('textbox', { name: 'Student name' })).toBeTruthy();
    await expect(container).toHaveNoViolations();
  });

  it('forwards value changes like a plain input', async () => {
    const user = userEvent.setup();
    render(<Input aria-label="Student name" />);
    const input = screen.getByRole('textbox', { name: 'Student name' });
    await user.type(input, 'Rahim');
    expect((input as HTMLInputElement).value).toBe('Rahim');
  });

  it('forwards disabled', () => {
    render(<Input aria-label="Student name" disabled />);
    expect(screen.getByRole('textbox', { name: 'Student name' }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('a bare input with no accessible name fails the axe check — this is why FormField exists', async () => {
    const { container } = render(<Input />);
    await expect(expect(container).toHaveNoViolations()).rejects.toThrow();
  });
});
