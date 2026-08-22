import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Textarea } from './textarea';

describe('Textarea', () => {
  it('renders and is axe clean when given an accessible name', async () => {
    const { container } = render(<Textarea aria-label="Reminder message" />);
    expect(screen.getByRole('textbox', { name: 'Reminder message' })).toBeTruthy();
    await expect(container).toHaveNoViolations();
  });

  it('forwards value changes like a plain textarea', async () => {
    const user = userEvent.setup();
    render(<Textarea aria-label="Reminder message" />);
    const textarea = screen.getByRole('textbox', { name: 'Reminder message' });
    await user.type(textarea, 'Dear guardian');
    expect((textarea as HTMLTextAreaElement).value).toBe('Dear guardian');
  });

  it('forwards disabled', () => {
    render(<Textarea aria-label="Reminder message" disabled />);
    expect(screen.getByRole('textbox', { name: 'Reminder message' }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('a bare textarea with no accessible name fails the axe check — this is why FormField exists', async () => {
    const { container } = render(<Textarea />);
    await expect(expect(container).toHaveNoViolations()).rejects.toThrow();
  });
});
