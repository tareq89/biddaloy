import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '../test/render-with-providers';

import { Stepper, StepIndicator } from './step-indicator';

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
    expect(screen.getByText('Step 2 of 3')).toBeTruthy();
    expect(screen.getAllByText('Details').length).toBeGreaterThan(0);
  });

  it('names the nav by label and keeps one segment per step', () => {
    render(<Stepper steps={steps} current="b" progressLabel="Step 2 of 3" label="Steps" />);
    const nav = screen.getByRole('navigation', { name: 'Steps' });
    expect(nav.querySelectorAll('span.h-1')).toHaveLength(3);
    expect(nav.querySelectorAll('span.h-1.bg-primary')).toHaveLength(2);
    expect(nav.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
  });

  it('StepIndicator is the same component as Stepper', () => {
    expect(StepIndicator).toBe(Stepper);
  });
});
