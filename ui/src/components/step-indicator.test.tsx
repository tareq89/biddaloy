import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '../test/render-with-providers';

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

  it('draws a tick for done steps, says "done" to screen readers, and numbers the rest', async () => {
    const view = renderWithProviders(
      <StepIndicator steps={steps} current="b" progressLabel="Step 2 of 3" />,
      { locale: 'en' },
    );
    await view.localeReady;
    const [done, active, later] = screen.getAllByRole('listitem') as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];
    expect(done.querySelector('svg')).not.toBeNull();
    expect(done.textContent).toBe('Account (done)');
    expect(active.textContent).toBe('2Details');
    expect(later.textContent).toBe('3Verify');
  });

  it('carries the phone text with the active label', () => {
    render(<StepIndicator steps={steps} current="b" progressLabel="Step 2 of 3" />);
    expect(screen.getByText(/Step 2 of 3/).textContent).toContain('Details');
  });
});
