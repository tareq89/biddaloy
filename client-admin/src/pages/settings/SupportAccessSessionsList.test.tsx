import '@biddaloy/ui/test';

import { REGION_BD_EN, RegionConfigProvider } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SupportAccessSessionsList } from './SupportAccessSessionsList';

const opts = { locale: 'en' as const, role: 'ADMIN' as const, tenantId: 'school-1' };

const base = {
  ownerName: 'Owner',
  viewOnly: false,
  role: 'TEACHER',
  personName: 'Rahim',
  reason: 'Bug check',
  changedCount: 0,
};
const live = {
  ...base,
  id: 's1',
  startedAt: '2026-11-10T10:00:00.000Z',
  endedAt: null,
  status: 'ACTIVE' as const,
  kind: 'NORMAL' as const,
  changedCount: 3,
};
const done = {
  ...base,
  id: 's2',
  personName: 'Karim',
  role: 'OFFICE_STAFF',
  reason: 'Locked out',
  startedAt: '2026-11-01T10:00:00.000Z',
  endedAt: '2026-11-01T10:18:00.000Z',
  status: 'ENDED' as const,
  kind: 'EMERGENCY' as const,
  viewOnly: true,
  changedCount: 1,
};

function renderList(over: Partial<React.ComponentProps<typeof SupportAccessSessionsList>> = {}) {
  return renderWithProviders(
    <RegionConfigProvider value={REGION_BD_EN}>
      <SupportAccessSessionsList
        sessions={[live, done]}
        platformActions={[
          {
            id: 'a1',
            at: '2026-11-05T09:00:00.000Z',
            actorName: 'Owner',
            label: 'SMS credit added',
            reason: 'Top up',
          },
        ]}
        loading={false}
        error={false}
        onEnd={() => undefined}
        {...over}
      />
    </RegionConfigProvider>,
    opts,
  );
}

describe('SupportAccessSessionsList', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders who, why, type and number of changes, and the platform actions', async () => {
    renderList();
    expect(await screen.findByText('Biddaloy support, Rahim (Teacher)')).toBeTruthy();
    expect(screen.getByText('Bug check')).toBeTruthy();
    expect(screen.getByText('3 changes')).toBeTruthy();
    expect(screen.getByText('Biddaloy support, Karim (Office staff)')).toBeTruthy();
    expect(screen.getByText('Emergency')).toBeTruthy();
    expect(screen.getByText('View only')).toBeTruthy();
    expect(screen.getByText('1 change')).toBeTruthy();
    expect(screen.getByText('SMS credit added')).toBeTruthy();
  });

  it('only a live row has End, and it confirms before calling onEnd', async () => {
    const onEnd = vi.fn();
    const { user } = renderList({ onEnd });
    await screen.findByText('Bug check');
    expect(screen.getAllByRole('button', { name: /^End/ })).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: /^End/ }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Rahim will leave your school now.')).toBeTruthy();
    expect(onEnd).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'End' }));
    expect(onEnd).toHaveBeenCalledWith('s1');
  });

  it('shows the empty sentences', async () => {
    renderList({ sessions: [], platformActions: [] });
    expect(
      await screen.findByText(
        'Nobody from Biddaloy support has logged in during the last 90 days.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('No other actions in the last 90 days.')).toBeTruthy();
  });

  it('shows the load error', async () => {
    renderList({ sessions: undefined, platformActions: undefined, error: true });
    expect(
      (await screen.findAllByText('Could not load the list. Try again.')).length,
    ).toBeGreaterThan(0);
  });
});
