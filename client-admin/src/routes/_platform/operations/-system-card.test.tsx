import type { OpsSystem } from '@biddaloy/ui/hooks';
import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { SystemCard } from './-system-card';

const OK: OpsSystem = {
  appVersion: '1.42.0',
  lastMigration: null,
  database: 'ok',
  redis: 'ok',
  restoring: [],
};
afterEach(async () => {
  await cleanupTestState();
});

describe('SystemCard', () => {
  it('shows version, no-migration text and all good', async () => {
    const { localeReady } = renderWithProviders(<SystemCard system={OK} />, { locale: 'en' });
    await localeReady;
    expect(await screen.findByText('1.42.0')).toBeTruthy();
    expect(screen.getByText('None has run yet')).toBeTruthy();
    expect(screen.getByText('Everything is running.')).toBeTruthy();
  });

  it('names Redis when only Redis is down', async () => {
    const { localeReady } = renderWithProviders(<SystemCard system={{ ...OK, redis: 'fail' }} />, {
      locale: 'en',
    });
    await localeReady;
    expect(
      screen.getByText('Not working: Redis. Schools may not work properly right now.'),
    ).toBeTruthy();
  });

  it('names both when both are down', async () => {
    const { localeReady } = renderWithProviders(
      <SystemCard system={{ ...OK, redis: 'fail', database: 'fail' }} />,
      {
        locale: 'en',
      },
    );
    await localeReady;
    expect(screen.getByText(/Not working: Database, Redis\./)).toBeTruthy();
  });
});
