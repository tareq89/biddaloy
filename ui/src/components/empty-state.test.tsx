import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { EmptyState } from './empty-state';

describe('EmptyState', () => {
  it('renders the title, explanation and action', () => {
    render(
      <EmptyState
        title="No fee structures yet"
        explanation="Create one to start generating monthly fees."
        action={{ label: 'Create fee structure', onClick: vi.fn() }}
      />,
    );
    expect(screen.getByRole('heading', { name: 'No fee structures yet' })).toBeTruthy();
    expect(screen.getByText('Create one to start generating monthly fees.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create fee structure' })).toBeTruthy();
  });

  it("renders title as a level-1 heading — [8.9.7]'s useRouteFocus depends on every placeholder route having exactly one <h1>", () => {
    render(
      <EmptyState
        title="No students"
        explanation="Add a student to get started."
        action={{ label: 'Add student', onClick: vi.fn() }}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'No students' })).toBeTruthy();
  });

  it('calls the action handler on click', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <EmptyState
        title="No students"
        explanation="Add a student to get started."
        action={{ label: 'Add student', onClick }}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Add student' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is axe clean', async () => {
    const { container } = render(
      <EmptyState
        title="No students"
        explanation="Add a student to get started."
        action={{ label: 'Add student', onClick: vi.fn() }}
      />,
    );
    await expect(container).toHaveNoViolations();
  });

  it('wraps a passed icon in a sizing/colour container rather than rendering it bare at whatever size the caller happened to pass', () => {
    render(
      <EmptyState
        title="No students"
        explanation="Add a student to get started."
        action={{ label: 'Add student', onClick: vi.fn() }}
        icon={<svg data-testid="icon" />}
      />,
    );
    const icon = screen.getByTestId('icon');
    const wrapper = icon.parentElement;
    expect(wrapper?.className).toContain('text-muted-foreground');
    expect(wrapper?.className).toContain('size-8');
  });

  it('renders no icon wrapper at all when no icon is passed', () => {
    const { container } = render(
      <EmptyState
        title="No students"
        explanation="Add a student to get started."
        action={{ label: 'Add student', onClick: vi.fn() }}
      />,
    );
    expect(container.querySelector('svg')).toBeNull();
  });

  it('defaults to the "nothing yet" kind — a dashed outline, the shape every caller written before [8.13.11] already had', () => {
    const { container } = render(
      <EmptyState
        title="No students"
        explanation="Add a student to get started."
        action={{ label: 'Add student', onClick: vi.fn() }}
      />,
    );
    const root = container.querySelector('[data-slot="empty-state"]');
    expect(root?.getAttribute('data-kind')).toBe('empty');
    expect(root?.className).toContain('border-dashed');
  });

  it('renders "no results" as a visually distinct state — a solid outline, because the container is real and populated elsewhere', () => {
    const { container } = render(
      <EmptyState
        kind="no-results"
        title="No students match these filters"
        explanation="Try a different class or clear the filters."
        action={{ label: 'Clear filters', onClick: vi.fn() }}
      />,
    );
    const root = container.querySelector('[data-slot="empty-state"]');
    expect(root?.getAttribute('data-kind')).toBe('no-results');
    expect(root?.className).not.toContain('border-dashed');
  });

  it('gives the "no results" icon its own well so the two kinds differ before a word of copy is read', () => {
    const { container } = render(
      <EmptyState
        kind="no-results"
        title="No students match these filters"
        explanation="Try a different class or clear the filters."
        action={{ label: 'Clear filters', onClick: vi.fn() }}
        icon={<svg data-testid="icon" />}
      />,
    );
    const wrapper = container.querySelector('[data-testid="icon"]')?.parentElement;
    expect(wrapper?.className).toContain('bg-secondary');
    expect(wrapper?.className).toContain('text-secondary-foreground');
  });

  it('renders no secondary action unless one is passed', () => {
    render(
      <EmptyState
        title="No students"
        explanation="Add a student to get started."
        action={{ label: 'Add student', onClick: vi.fn() }}
      />,
    );
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('offers a second way out when one is passed, and calls it', async () => {
    const onSecondary = vi.fn();
    const user = userEvent.setup();
    render(
      <EmptyState
        kind="no-results"
        title="No students match these filters"
        explanation="Try a different class, or add the student you were looking for."
        action={{ label: 'Clear filters', onClick: vi.fn() }}
        secondaryAction={{ label: 'Add student', onClick: onSecondary }}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Add student' }));
    expect(onSecondary).toHaveBeenCalledTimes(1);
  });

  it('is axe clean in the no-results kind too', async () => {
    const { container } = render(
      <EmptyState
        kind="no-results"
        title="No students match these filters"
        explanation="Try a different class or clear the filters."
        action={{ label: 'Clear filters', onClick: vi.fn() }}
        secondaryAction={{ label: 'Add student', onClick: vi.fn() }}
        icon={<svg data-testid="icon" aria-hidden="true" />}
      />,
    );
    await expect(container).toHaveNoViolations();
  });
});
