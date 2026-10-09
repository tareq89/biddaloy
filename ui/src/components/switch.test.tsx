import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Switch } from './switch';

describe('Switch', () => {
  it('renders role="switch" with the given name and is axe clean', async () => {
    const { container } = render(<Switch aria-label="Late attendance alert" />);
    const sw = screen.getByRole('switch', { name: 'Late attendance alert' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    await expect(container).toHaveNoViolations();
  });

  it('toggles on click and on Space, calling onCheckedChange', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Switch aria-label="Late attendance alert" onCheckedChange={onCheckedChange} />);
    const sw = screen.getByRole('switch');
    await user.click(sw);
    expect(sw.getAttribute('aria-checked')).toBe('true');
    sw.focus();
    await user.keyboard(' ');
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(onCheckedChange.mock.calls).toEqual([[true], [false]]);
  });

  it('disabled blocks click and Space, and keeps its checked look', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(
      <Switch aria-label="Locked rule" disabled defaultChecked onCheckedChange={onCheckedChange} />,
    );
    const sw = screen.getByRole('switch');
    await user.click(sw);
    sw.focus();
    await user.keyboard(' ');
    expect(onCheckedChange).not.toHaveBeenCalled();
    expect(sw.getAttribute('aria-checked')).toBe('true');
  });
});
