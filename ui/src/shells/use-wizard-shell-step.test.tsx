import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RouteObject } from 'react-router';
import { describe, expect, it } from 'vitest';

import { renderWithRouter } from '../test/render-with-router';

import { useWizardShellStep } from './use-wizard-shell-step';

const STEPS = ['amount', 'method', 'review'] as const;

function Probe() {
  const [currentStepId, setStep] = useWizardShellStep(STEPS);
  return (
    <div>
      <p>current: {currentStepId}</p>
      <button onClick={() => setStep('method')}>Go to method</button>
    </div>
  );
}

const routes: RouteObject[] = [{ path: '/payments/new', element: <Probe /> }];

describe('useWizardShellStep', () => {
  it('falls back to the first step when ?step= is absent', () => {
    renderWithRouter(routes, { initialEntries: ['/payments/new'] });
    expect(screen.getByText('current: amount')).toBeTruthy();
  });

  it('reads a valid ?step= from the URL', () => {
    renderWithRouter(routes, { initialEntries: ['/payments/new?step=review'] });
    expect(screen.getByText('current: review')).toBeTruthy();
  });

  it('falls back to the first step for an unknown ?step= value', () => {
    renderWithRouter(routes, { initialEntries: ['/payments/new?step=nonexistent'] });
    expect(screen.getByText('current: amount')).toBeTruthy();
  });

  it('setStep writes ?step= into the URL, and the value survives a refresh', async () => {
    const user = userEvent.setup();
    const { router, unmount } = renderWithRouter(routes, { initialEntries: ['/payments/new'] });
    await user.click(screen.getByRole('button', { name: 'Go to method' }));
    expect(router.state.location.search).toContain('step=method');

    unmount();
    renderWithRouter(routes, { initialEntries: [`/payments/new${router.state.location.search}`] });
    expect(screen.getByText('current: method')).toBeTruthy();
  });
});
