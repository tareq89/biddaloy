import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LoginAsLog, visitMinutes } from './-login-as-log';

const ROW = {
  id: 'v1',
  ownerId: 'o1',
  ownerName: 'Owner One',
  schoolId: 's1',
  schoolName: 'Rose Valley School',
  role: 'TEACHER',
  personName: 'Anika Rahman',
  reason: 'Parent could not see the timetable',
  entryKind: 'NORMAL',
  startedAt: '2029-12-31T00:00:00.000Z',
  endedAt: '2029-12-31T00:18:00.000Z',
  status: 'ENDED',
  changedCount: 4,
};
const props = { loading: false, isFetching: false };

afterEach(async () => {
  await cleanupTestState();
});

describe('LoginAsLog', () => {
  it('shows who, school, reason and length, and opens the visit', async () => {
    const onOpen = vi.fn();
    const { localeReady } = renderWithProviders(
      <LoginAsLog {...props} rows={[ROW]} onOpen={onOpen} />,
      { locale: 'en' },
    );
    await localeReady;
    expect((await screen.findAllByText('Owner One')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Parent could not see the timetable').length).toBeGreaterThan(0);
    expect(screen.getAllByText('18 min').length).toBeGreaterThan(0);
    await userEvent
      .setup()
      .click(screen.getAllByRole('button', { name: /See all activity of the visit as Anika/ })[0]!);
    expect(onOpen).toHaveBeenCalledWith('v1');
  });

  it('a visit with no end is Live', async () => {
    expect(visitMinutes({ startedAt: ROW.startedAt, endedAt: null })).toBeNull();
    const { localeReady } = renderWithProviders(
      <LoginAsLog
        {...props}
        rows={[{ ...ROW, endedAt: null, status: 'ACTIVE' }]}
        onOpen={vi.fn()}
      />,
      { locale: 'en' },
    );
    await localeReady;
    expect((await screen.findAllByText('Live')).length).toBeGreaterThan(0);
  });

  it('says so when empty', async () => {
    const { localeReady } = renderWithProviders(
      <LoginAsLog {...props} rows={[]} onOpen={vi.fn()} />,
      { locale: 'en' },
    );
    await localeReady;
    expect(await screen.findByText('No Login as visits')).toBeTruthy();
  });
});
