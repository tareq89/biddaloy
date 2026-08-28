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

  // [8.13.10]
  it('the focus ring is a two-tone offset ring, not the old brand-on-brand 50%-alpha ring', () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.className).toContain('focus-visible:ring-2');
    expect(button.className).toContain('focus-visible:ring-ring');
    expect(button.className).toContain('focus-visible:ring-offset-2');
    expect(button.className).toContain('focus-visible:ring-offset-background');
    expect(button.className).not.toContain('ring-ring/50');
    expect(button.className).not.toContain('border-ring');
  });

  it('secondary renders a brand-tinted surface with a real border and hover, not the dead color-mix on a transparent border', () => {
    render(<Button variant="secondary">Archive</Button>);
    const button = screen.getByRole('button', { name: 'Archive' });
    expect(button.className).toContain('bg-secondary');
    expect(button.className).toContain('text-secondary-foreground');
    expect(button.className).toContain('border-border-subtle');
    expect(button.className).toContain('hover:bg-brand-100');
    expect(button.className).not.toContain('color-mix');
    expect(button.className).not.toContain('border-transparent');
  });

  it('disabled default and secondary buttons use an explicit muted token pair instead of a blanket opacity halving', () => {
    render(
      <>
        <Button disabled>Save</Button>
        <Button disabled variant="secondary">
          Archive
        </Button>
      </>,
    );
    for (const button of screen.getAllByRole('button')) {
      expect(button.className).toContain('disabled:bg-muted');
      expect(button.className).toContain('disabled:text-muted-foreground');
      expect(button.className).toContain('disabled:opacity-100');
      // The base cva string still carries `disabled:opacity-50`; only
      // `tailwind-merge`'s conflict resolution (via `cn()`) drops it in
      // favour of this variant's `disabled:opacity-100`. Asserting its
      // absence, not just the override's presence, is what would catch a
      // regression that reintroduces the below-4.5:1 disabled-text bug this
      // pair fixes — e.g. a reordered cva string or a `cn()` bypass that
      // left both classes in the DOM together.
      expect(button.className).not.toContain('disabled:opacity-50');
    }
  });

  // Documents the deliberate exception noted in the base cva string's
  // comment: variants this ticket did not re-point (outline/ghost/
  // destructive/link) — and icon-only usage of any variant — keep the plain
  // opacity halving, since they are not the solid-filled 4.5:1 text case
  // `default`/`secondary` are.
  it('disabled outline and ghost buttons still use the plain opacity treatment', () => {
    render(
      <>
        <Button disabled variant="outline">
          Cancel
        </Button>
        <Button disabled variant="ghost">
          Dismiss
        </Button>
      </>,
    );
    for (const button of screen.getAllByRole('button')) {
      expect(button.className).toContain('disabled:opacity-50');
      expect(button.className).not.toContain('disabled:bg-muted');
    }
  });
});
