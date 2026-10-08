import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { StepIndicator } from './step-indicator';

const steps = [
  { id: 'first', label: 'First' },
  { id: 'second', label: 'Second' },
  { id: 'third', label: 'Third' },
];

describe('StepIndicator', () => {
  it('only completed steps are buttons; current has aria-current', async () => {
    const onStepChange = vi.fn();
    render(<StepIndicator steps={steps} currentStepId="second" onStepChange={onStepChange} />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByText('Second').closest('li')?.getAttribute('aria-current')).toBe('step');
    expect(screen.getByText('Third').closest('button')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'First' }));
    expect(onStepChange).toHaveBeenCalledWith('first');
  });

  it('without onStepChange no step is a button', () => {
    render(<StepIndicator steps={steps} currentStepId="third" />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('nav only when labelled', () => {
    const { rerender } = render(<StepIndicator steps={steps} currentStepId="first" />);
    expect(screen.queryByRole('navigation')).toBeNull();
    rerender(<StepIndicator steps={steps} currentStepId="first" label="Steps" />);
    expect(screen.getByRole('navigation', { name: 'Steps' })).toBeTruthy();
  });

  it('is axe clean', async () => {
    const { container } = render(
      <StepIndicator steps={steps} currentStepId="second" onStepChange={() => {}} label="Steps" />,
    );
    await expect(container).toHaveNoViolations();
  });
});
