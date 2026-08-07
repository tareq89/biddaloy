import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectKeyboardOperable } from '../test/a11y';

import { Button } from './button';

describe('Button', () => {
  it('renders its children', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });

  it('is keyboard-operable and axe clean', async () => {
    const onClick = vi.fn();
    const { container } = render(<Button onClick={onClick}>Save</Button>);
    await expectKeyboardOperable(screen.getByRole('button', { name: 'Save' }));
    await expect(container).toHaveNoViolations();
  });

  it('an icon-only button with a required aria-label is axe clean', async () => {
    const { container } = render(
      <Button iconOnly aria-label="Delete row">
        <span aria-hidden="true">×</span>
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Delete row' })).toBeTruthy();
    await expect(container).toHaveNoViolations();
  });

  it('loading sets aria-busy, disables the button, and announces "Loading" without changing the visible label', () => {
    render(<Button loading>Save</Button>);
    const button = screen.getByRole('button');
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Save')).toBeTruthy();
    expect(screen.getByText('Loading').classList.contains('sr-only')).toBe(true);
  });

  it('loading prevents the click handler from firing even if a caller forgets to also disable it', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    await user.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('an explicit disabled still disables the button when not loading', () => {
    render(<Button disabled>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true);
  });

  it('asChild with loading sets aria-busy/disabled but skips the spinner and sr-only text, since Slot needs a single child', async () => {
    const { container } = render(
      <Button asChild loading>
        <a href="/save">Save</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'Save' });
    expect(link.getAttribute('aria-busy')).toBe('true');
    expect(link.hasAttribute('disabled')).toBe(true);
    expect(screen.queryByText('Loading')).toBeNull();
    await expect(container).toHaveNoViolations();
  });
});
