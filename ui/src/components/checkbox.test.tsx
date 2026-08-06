import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Checkbox } from './checkbox';

describe('Checkbox', () => {
  it('renders unchecked by default and is axe clean when given an accessible name', async () => {
    const { container } = render(<Checkbox aria-label="Send SMS reminders" />);
    const checkbox = screen.getByRole('checkbox', { name: 'Send SMS reminders' });
    expect(checkbox.getAttribute('aria-checked')).toBe('false');
    await expect(container).toHaveNoViolations();
  });

  it('toggles on click', async () => {
    const user = userEvent.setup();
    render(<Checkbox aria-label="Send SMS reminders" />);
    const checkbox = screen.getByRole('checkbox', { name: 'Send SMS reminders' });
    await user.click(checkbox);
    expect(checkbox.getAttribute('aria-checked')).toBe('true');
  });

  it('toggles on Space when focused (keyboard-operable)', async () => {
    const user = userEvent.setup();
    render(<Checkbox aria-label="Send SMS reminders" />);
    const checkbox = screen.getByRole('checkbox', { name: 'Send SMS reminders' });
    checkbox.focus();
    await user.keyboard(' ');
    expect(checkbox.getAttribute('aria-checked')).toBe('true');
  });
});
