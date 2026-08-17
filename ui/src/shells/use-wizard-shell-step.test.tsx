import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

function buildRouteTree() {
  const rootRoute = createRootRoute();
  const paymentsNewRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/payments/new',
    component: Probe,
  });
  return rootRoute.addChildren([paymentsNewRoute]);
}

// TanStack Router's initial route match resolves asynchronously — see
// `use-list-url-state.test.tsx`'s own comment for why every test here
// awaits the first thing it looks for.
describe('useWizardShellStep', () => {
  it('falls back to the first step when ?step= is absent', async () => {
    renderWithRouter(buildRouteTree(), { initialEntries: ['/payments/new'] });
    expect(await screen.findByText('current: amount')).toBeTruthy();
  });

  it('reads a valid ?step= from the URL', async () => {
    renderWithRouter(buildRouteTree(), { initialEntries: ['/payments/new?step=review'] });
    expect(await screen.findByText('current: review')).toBeTruthy();
  });

  it('falls back to the first step for an unknown ?step= value', async () => {
    renderWithRouter(buildRouteTree(), { initialEntries: ['/payments/new?step=nonexistent'] });
    expect(await screen.findByText('current: amount')).toBeTruthy();
  });

  it('setStep writes ?step= into the URL, and the value survives a refresh', async () => {
    const user = userEvent.setup();
    const { router, unmount } = renderWithRouter(buildRouteTree(), {
      initialEntries: ['/payments/new'],
    });
    await user.click(await screen.findByRole('button', { name: 'Go to method' }));
    expect(router.state.location.searchStr).toContain('step=method');

    const urlAfterUpdate = router.state.location.href;
    unmount();
    renderWithRouter(buildRouteTree(), { initialEntries: [urlAfterUpdate] });
    expect(await screen.findByText('current: method')).toBeTruthy();
  });

  it('setStep preserves unrelated query params rather than dropping them', async () => {
    const user = userEvent.setup();
    const { router } = renderWithRouter(buildRouteTree(), {
      initialEntries: ['/payments/new?page=2&sort=name'],
    });

    await user.click(await screen.findByRole('button', { name: 'Go to method' }));

    expect(router.state.location.searchStr).toContain('step=method');
    expect(router.state.location.searchStr).toContain('page=2');
    expect(router.state.location.searchStr).toContain('sort=name');
  });

  it('setStep replaces an existing ?step= rather than adding a second one', async () => {
    const user = userEvent.setup();
    const { router } = renderWithRouter(buildRouteTree(), {
      initialEntries: ['/payments/new?step=amount'],
    });

    await user.click(await screen.findByRole('button', { name: 'Go to review' }));

    const stepValues = new URLSearchParams(router.state.location.searchStr).getAll('step');
    expect(stepValues).toEqual(['review']);
  });

  it('setStep ignores a step id that is not in stepIds, rather than writing a stale value into the URL', async () => {
    const user = userEvent.setup();
    const { router } = renderWithRouter(buildRouteTree(), {
      initialEntries: ['/payments/new?step=method'],
    });

    await user.click(await screen.findByRole('button', { name: 'Go to an unknown step' }));

    expect(router.state.location.searchStr).toContain('step=method');
    expect(router.state.location.searchStr).not.toContain('nonexistent');
    expect(screen.getByText('current: method')).toBeTruthy();
  });
});
