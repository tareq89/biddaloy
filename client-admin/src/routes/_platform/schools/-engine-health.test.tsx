import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineHealthCard } from './-engine-health';

const NOW = new Date('2026-10-09T10:00:00Z');
const ok = {
  lastSweep: {
    FAST: '2026-10-09T09:58:00Z',
    HOURLY: '2026-10-09T09:30:00Z',
    DAILY: '2026-10-09T01:00:00Z',
  },
  durationsMs: { FAST: 1200, HOURLY: 4300, DAILY: 21000 },
  failingRules: [],
};
const opts = { locale: 'en' as const, role: 'SUPER_ADMIN' as const };

function renderCard(props: Partial<React.ComponentProps<typeof EngineHealthCard>> = {}) {
  return renderWithProviders(
    <EngineHealthCard health={ok} loading={false} onRetry={() => undefined} now={NOW} {...props} />,
    opts,
  );
}

describe('EngineHealthCard', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('healthy: Running badge and the four facts', async () => {
    renderCard();
    expect(await screen.findByText('Running')).toBeTruthy();
    for (const label of ['Last check', 'Took', 'Last hourly check', 'Last daily check']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText(/^\S+ s$/)).toBeTruthy();
    expect(screen.getByText('No rule is failing.')).toBeTruthy();
  });

  it('is Late when the quick check is older than 15 minutes', async () => {
    renderCard({
      health: { ...ok, lastSweep: { ...ok.lastSweep, FAST: '2026-10-09T09:30:00Z' } },
    });
    expect(await screen.findByText('Late')).toBeTruthy();
  });

  it('lists failing rules with translated names, counts and the technical error', async () => {
    renderCard({
      health: {
        ...ok,
        failingRules: [
          { key: 'attendance.not_taken', count: 3, lastError: 'deadlock detected' },
          { key: 'fees.overdue_rising', count: 1, lastError: 'Timeout' },
        ],
      },
    });
    expect(await screen.findByText(/rules failing$/)).toBeTruthy();
    expect(screen.getByText(/Failed .+ times/)).toBeTruthy();
    expect(screen.getByText('deadlock detected')).toBeTruthy();
    expect(screen.queryByText('attendance.not_taken')).toBeNull();
  });

  it('shows "Not run yet" for sweeps that never ran', async () => {
    renderCard({
      health: {
        lastSweep: { FAST: null, HOURLY: null, DAILY: null },
        durationsMs: { FAST: null, HOURLY: null, DAILY: null },
        failingRules: [],
      },
    });
    expect((await screen.findAllByText('Not run yet')).length).toBe(4);
    expect(screen.getByText('Late')).toBeTruthy();
  });

  it('error: Retry calls the handler', async () => {
    const onRetry = vi.fn();
    const { user } = renderCard({ health: undefined, error: true, onRetry });
    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('has no accessibility violations', async () => {
    const { container } = renderCard({
      health: { ...ok, failingRules: [{ key: 'fees.overdue_rising', count: 1, lastError: 'x' }] },
    });
    await screen.findByText(/rule failing$/);
    await expect(container).toHaveNoViolations();
  });
});
