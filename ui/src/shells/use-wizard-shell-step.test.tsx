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
      <button onClick={() => setStep('review')}>Go to review</button>
      <button onClick={() => setStep('nonexistent')}>Go to an unknown step</button>
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

  it('setStep preserves unrelated query params rather than dropping them', async () => {
    const user = userEvent.setup();
    const { router } = renderWithRouter(routes, {
      initialEntries: ['/payments/new?page=2&sort=name'],
    });

    await user.click(screen.getByRole('button', { name: 'Go to method' }));

    expect(router.state.location.search).toContain('step=method');
    expect(router.state.location.search).toContain('page=2');
    expect(router.state.location.search).toContain('sort=name');
  });

  it('setStep replaces an existing ?step= rather than adding a second one', async () => {
    const user = userEvent.setup();
    const { router } = renderWithRouter(routes, {
      initialEntries: ['/payments/new?step=amount'],
    });

    await user.click(screen.getByRole('button', { name: 'Go to review' }));

    const stepValues = new URLSearchParams(router.state.location.search).getAll('step');
    expect(stepValues).toEqual(['review']);
  });

  it('setStep ignores a step id that is not in stepIds, rather than writing a stale value into the URL', async () => {
    const user = userEvent.setup();
    const { router } = renderWithRouter(routes, { initialEntries: ['/payments/new?step=method'] });

    await user.click(screen.getByRole('button', { name: 'Go to an unknown step' }));

    expect(router.state.location.search).toContain('step=method');
    expect(router.state.location.search).not.toContain('nonexistent');
    expect(screen.getByText('current: method')).toBeTruthy();
  });
});
