import { routineCellKey, type RoutineGridPeriodRow } from '@biddaloy/ui/components';
import { REGION_BD_BN } from '@biddaloy/ui/i18n';
import { renderWithProviders } from '@biddaloy/ui/test';
import { formatNumber } from '@biddaloy/ui/utils';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BuilderDayList } from './-builder-day-list';

const PERIODS: RoutineGridPeriodRow[] = [
  { id: 'p1', sequence: 1, kind: 'CLASS', name: null, starts_at: '08:00', ends_at: '08:40' },
  { id: 'b1', sequence: 2, kind: 'BREAK', name: 'Tiffin', starts_at: '08:40', ends_at: '09:00' },
  { id: 'p2', sequence: 3, kind: 'CLASS', name: null, starts_at: '09:00', ends_at: '09:40' },
];
const LABELS = { 0: 'Sun', 1: 'Mon' };
const CELLS = {
  [routineCellKey(0, 'p1')]: {
    slotId: 's1',
    subjectLabel: 'Math',
    teacherLabels: ['Ms Nahar'],
    recurrence: 'WEEKLY' as const,
    hasViolation: false,
    hasWarning: false,
  },
};

function renderList(onActivateCell = vi.fn()) {
  renderWithProviders(
    <BuilderDayList
      weekdays={[0, 1]}
      weekdayLabels={LABELS}
      periods={PERIODS}
      cells={CELLS}
      onActivateCell={onActivateCell}
    />,
    { locale: 'en' },
  );
  return onActivateCell;
}

describe('BuilderDayList', () => {
  afterEach(() => vi.useRealTimers());

  it('has a tab per working day and a break row that is not a button', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 4)); // a Sunday
    renderList();

    expect(await screen.findByRole('tab', { name: 'Sun', selected: true })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Mon' })).toBeTruthy();
    expect(screen.getByText(/Tiffin/)).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('names a filled row like the grid cell and opens the picker for an empty row', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 4));
    const onActivate = renderList();
    const user = userEvent.setup();

    expect(
      // The period number follows the school's numerals (BD default: Bangla digits).
      await screen.findByRole('button', {
        name: `Sun, Period ${formatNumber(1, REGION_BD_BN)}: Math, Ms Nahar`,
      }),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /: empty$/ }));
    await waitFor(() => expect(onActivate).toHaveBeenCalledWith(0, 'p2'));
  });
});
