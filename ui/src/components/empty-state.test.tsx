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
    expect(screen.getByText('No fee structures yet')).toBeTruthy();
    expect(screen.getByText('Create one to start generating monthly fees.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create fee structure' })).toBeTruthy();
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
});
