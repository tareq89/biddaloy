import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TrialCard, trialDaysLeft } from './trial-card';

const FUTURE = new Date(Date.now() + 12 * 86_400_000).toISOString();
const PAST = '2026-01-10T00:00:00.000Z';

describe('trialDaysLeft', () => {
  it('rounds up and goes to 0 or below once ended', () => {
    const now = Date.parse('2026-05-01T12:00:00.000Z');
    expect(trialDaysLeft('2026-05-02T00:00:00.000Z', now)).toBe(1);
    expect(trialDaysLeft('2026-05-01T12:00:00.000Z', now)).toBe(0);
    expect(trialDaysLeft('2026-04-01T00:00:00.000Z', now)).toBeLessThan(0);
  });
});

describe('TrialCard', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders nothing for a school that never had a trial', () => {
    const { container } = renderWithProviders(
      <TrialCard school={{ trial_ends_at: null, seat_limit: null }} onExtend={() => {}} />,
      { locale: 'en' },
    );
    expect(container.textContent).toBe('');
  });

  it('shows the end date and students used against the limit, and extends on click', async () => {
    const onExtend = vi.fn();
    const { user } = renderWithProviders(
      <TrialCard
        school={{ trial_ends_at: FUTURE, seat_limit: 50 }}
        studentsUsed={12}
        onExtend={onExtend}
      />,
      { locale: 'en' },
    );
    expect(await screen.findByText('Trial ends')).toBeTruthy();
    // Region defaults to Bengali numerals regardless of UI locale.
    expect(screen.getByText('১২ / ৫০')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Extend trial' }));
    expect(onExtend).toHaveBeenCalledTimes(1);
  });

  it('says the trial ended, and "no limit" for an unlimited school', async () => {
    renderWithProviders(
      <TrialCard
        school={{ trial_ends_at: PAST, seat_limit: null }}
        studentsUsed={3}
        onExtend={() => {}}
      />,
      { locale: 'en' },
    );
    expect(await screen.findByText('Trial ended')).toBeTruthy();
    expect(screen.getByText('৩ / no limit')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Extend trial' })).toBeTruthy();
  });
});
