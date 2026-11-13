import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RestoreLockCard } from './-restore-lock-card';

const ROW = {
  schoolId: 's-1',
  schoolName: 'Ananta School',
  jobStatus: 'RUNNING' as const,
  locked: true,
};
afterEach(async () => {
  await cleanupTestState();
});

describe('RestoreLockCard', () => {
  it('says so when no school is restoring', async () => {
    const { localeReady } = renderWithProviders(
      <RestoreLockCard restoring={[]} onRelease={vi.fn()} />,
      { locale: 'en' },
    );
    await localeReady;
    expect(await screen.findByText('No school is restoring right now.')).toBeTruthy();
  });

  it('does not release until the owner confirms', async () => {
    const onRelease = vi.fn();
    const user = userEvent.setup();
    const { localeReady } = renderWithProviders(
      <RestoreLockCard restoring={[ROW]} onRelease={onRelease} />,
      {
        locale: 'en',
      },
    );
    await localeReady;
    await user.click(screen.getByRole('button', { name: 'Release the lock of Ananta School' }));
    expect(onRelease).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/checked that no restore is running/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Release' }));
    expect(onRelease).toHaveBeenCalledWith('s-1');
  });

  it('disables Release for a school that is not locked', async () => {
    const { localeReady } = renderWithProviders(
      <RestoreLockCard restoring={[{ ...ROW, locked: false }]} onRelease={vi.fn()} />,
      { locale: 'en' },
    );
    await localeReady;
    expect(
      screen.getByRole('button', { name: 'Release the lock of Ananta School' }),
    ).toHaveProperty('disabled', true);
  });
});
