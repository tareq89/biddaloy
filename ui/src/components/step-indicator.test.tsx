import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StepIndicator } from './step-indicator';

const steps = [
  { id: 'a', label: 'Account' },
  { id: 'b', label: 'Details' },
  { id: 'c', label: 'Verify' },
];

describe('StepIndicator', () => {
  it('marks only the active step with aria-current', async () => {
    const { container } = render(
      <StepIndicator steps={steps} current="b" progressLabel="Step 2 of 3" />,
    );
    const items = screen.getAllByRole('listitem');
    expect(items.map((li) => li.getAttribute('aria-current'))).toEqual([null, 'step', null]);
    await expect(container).toHaveNoViolations();
  });

  it('carries the phone text with the active label', () => {
    render(<StepIndicator steps={steps} current="b" progressLabel="Step 2 of 3" />);
    expect(screen.getByText(/Step 2 of 3/).textContent).toContain('Details');
  });
});
