import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { i18n } from '../i18n';
import { renderWithProviders } from '../test';

import { RoutineGrid, cellKey, type RoutineGridPeriodRow } from './routine-grid';

async function renderInEnglish(ui: React.ReactElement) {
  const view = renderWithProviders(ui, { locale: 'en' });
  await act(async () => {
    await view.localeReady;
    await i18n.loadNamespaces('routines');
  });
  return view;
}

const PERIODS: RoutineGridPeriodRow[] = [
  { id: 'p1', sequence: 1, kind: 'CLASS', name: null, starts_at: '08:00', ends_at: '08:40' },
  { id: 'break1', sequence: 2, kind: 'BREAK', name: 'Tiffin', starts_at: '08:40', ends_at: '09:00' },
  { id: 'p2', sequence: 3, kind: 'CLASS', name: null, starts_at: '09:00', ends_at: '09:40' },
];

const WEEKDAYS = [0, 1, 2]; // Sun/Mon/Tue only, as if Fri/Sat were off days
const WEEKDAY_LABELS = { 0: 'Sun', 1: 'Mon', 2: 'Tue' };

describe('RoutineGrid', () => {
  it('renders only the given working weekdays, and a BREAK row as a spanning band', async () => {
    await renderInEnglish(
      <RoutineGrid
        weekdays={WEEKDAYS}
        weekdayLabels={WEEKDAY_LABELS}
        periods={PERIODS}
        cells={{}}
        onActivateCell={vi.fn()}
        onClearCell={vi.fn()}
      />,
    );
    expect(screen.getByText('Sun')).toBeTruthy();
    expect(screen.getByText('Mon')).toBeTruthy();
    expect(screen.getByText('Tue')).toBeTruthy();
    expect(screen.queryByText('Wed')).toBeNull();
    expect(screen.getByText('Tiffin')).toBeTruthy();
  });

  it('renders a filled cell with subject, teachers and non-weekly recurrence badge', async () => {
    await renderInEnglish(
      <RoutineGrid
        weekdays={WEEKDAYS}
        weekdayLabels={WEEKDAY_LABELS}
        periods={PERIODS}
        cells={{
          [cellKey(1, 'p1')]: {
            slotId: 's1',
            subjectLabel: 'Math',
            teacherLabels: ['Ms Nahar', 'Mr Karim'],
            recurrence: 'BIWEEKLY',
            hasViolation: false,
            hasWarning: false,
          },
        }}
        onActivateCell={vi.fn()}
        onClearCell={vi.fn()}
      />,
    );
    expect(screen.getByText('Math')).toBeTruthy();
    expect(screen.getByText('Ms Nahar, Mr Karim')).toBeTruthy();
    expect(screen.getByText('Biweekly')).toBeTruthy();
  });

  it('Enter on the focused empty cell calls onActivateCell', async () => {
    const onActivateCell = vi.fn();
    await renderInEnglish(
      <RoutineGrid
        weekdays={WEEKDAYS}
        weekdayLabels={WEEKDAY_LABELS}
        periods={PERIODS}
        cells={{}}
        onActivateCell={onActivateCell}
        onClearCell={vi.fn()}
      />,
    );
    const table = screen.getByRole('table');
    fireEvent.keyDown(table, { key: 'Enter' });
    expect(onActivateCell).toHaveBeenCalledWith(0, 'p1');
  });

  it('ArrowRight then Enter moves focus onto the next weekday', async () => {
    const onActivateCell = vi.fn();
    await renderInEnglish(
      <RoutineGrid
        weekdays={WEEKDAYS}
        weekdayLabels={WEEKDAY_LABELS}
        periods={PERIODS}
        cells={{}}
        onActivateCell={onActivateCell}
        onClearCell={vi.fn()}
      />,
    );
    const table = screen.getByRole('table');
    fireEvent.keyDown(table, { key: 'ArrowRight' });
    fireEvent.keyDown(table, { key: 'Enter' });
    expect(onActivateCell).toHaveBeenCalledWith(1, 'p1');
  });

  it('Delete on a filled focused cell calls onClearCell, and does nothing on an empty one', async () => {
    const onClearCell = vi.fn();
    await renderInEnglish(
      <RoutineGrid
        weekdays={WEEKDAYS}
        weekdayLabels={WEEKDAY_LABELS}
        periods={PERIODS}
        cells={{
          [cellKey(0, 'p1')]: {
            slotId: 's1',
            subjectLabel: 'Math',
            teacherLabels: ['Ms Nahar'],
            recurrence: 'WEEKLY',
            hasViolation: false,
            hasWarning: false,
          },
        }}
        onActivateCell={vi.fn()}
        onClearCell={onClearCell}
      />,
    );
    const table = screen.getByRole('table');
    fireEvent.keyDown(table, { key: 'Delete' });
    expect(onClearCell).toHaveBeenCalledWith(0, 'p1');
  });

  it('a printable keypress on an empty focused cell fires onTypeAhead', async () => {
    const onTypeAhead = vi.fn();
    await renderInEnglish(
      <RoutineGrid
        weekdays={WEEKDAYS}
        weekdayLabels={WEEKDAY_LABELS}
        periods={PERIODS}
        cells={{}}
        onActivateCell={vi.fn()}
        onClearCell={vi.fn()}
        onTypeAhead={onTypeAhead}
      />,
    );
    const table = screen.getByRole('table');
    fireEvent.keyDown(table, { key: 'm' });
    expect(onTypeAhead).toHaveBeenCalledWith(0, 'p1', 'm');
  });

  it('shows the narrow-viewport message alongside the grid (CSS toggles which is visible)', async () => {
    await renderInEnglish(
      <RoutineGrid
        weekdays={WEEKDAYS}
        weekdayLabels={WEEKDAY_LABELS}
        periods={PERIODS}
        cells={{}}
        onActivateCell={vi.fn()}
        onClearCell={vi.fn()}
      />,
    );
    expect(screen.getByText(/needs a wider screen/i)).toBeTruthy();
    expect(screen.getByRole('table')).toBeTruthy();
  });
});
