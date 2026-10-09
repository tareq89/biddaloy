import { CalendarEventType } from '@biddaloy/shared';
import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { REGION_BD_EN, RegionConfigProvider } from '../../i18n';
import { renderWithProviders } from '../../test/render-with-providers';
import { formatDate, formatMonth } from '../../utils/date';

import { MonthGrid, type MonthGridEvent, type MonthGridProps } from './month-grid';

const BASE: MonthGridProps = {
  month: '2026-10',
  firstDayOfWeek: 0,
  weeklyOffDays: [5, 6],
  events: [],
  weekdayLabels: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  moreLabel: (n) => `+${n} more`,
  today: '2026-10-08',
};

function ev(id: string): MonthGridEvent {
  return {
    id,
    type: CalendarEventType.EVENT,
    typeLabel: 'Event',
    name: `Event ${id}`,
    startDate: '2026-10-08',
    endDate: '2026-10-08',
  };
}

function setup(props: Partial<MonthGridProps> = {}) {
  return renderWithProviders(
    <RegionConfigProvider value={REGION_BD_EN}>
      <MonthGrid {...BASE} {...props} />
    </RegionConfigProvider>,
    { locale: 'en' },
  );
}

describe('MonthGrid', () => {
  it('renders the formatted month header and navigates', async () => {
    const onMonthChange = vi.fn();
    const { user, localeReady } = setup({ onMonthChange });
    await localeReady;
    expect(screen.getByText(formatMonth('2026-10', REGION_BD_EN))).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Next month' }));
    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(onMonthChange).toHaveBeenNthCalledWith(1, '2026-11');
    expect(onMonthChange).toHaveBeenNthCalledWith(2, '2026-09');
  });

  it('crosses the year boundary', async () => {
    const onMonthChange = vi.fn();
    const { user, localeReady } = setup({ month: '2026-12', onMonthChange });
    await localeReady;
    await user.click(screen.getByRole('button', { name: 'Next month' }));
    expect(onMonthChange).toHaveBeenCalledWith('2027-01');
  });

  it('Today jumps to the current month and day', async () => {
    const onMonthChange = vi.fn();
    const onDayClick = vi.fn();
    const { user, localeReady } = setup({ month: '2026-12', onMonthChange, onDayClick });
    await localeReady;
    await user.click(screen.getByRole('button', { name: 'Today' }));
    expect(onMonthChange).toHaveBeenCalledWith('2026-10');
    expect(onDayClick).toHaveBeenCalledWith('2026-10-08');
  });

  it('marks only today with aria-current and the selected day with aria-selected', async () => {
    const { localeReady } = setup({ selectedDate: '2026-10-12' });
    await localeReady;
    expect(screen.getByTestId('day-cell-2026-10-08').getAttribute('aria-current')).toBe('date');
    expect(document.querySelectorAll('[aria-current="date"]')).toHaveLength(1);
    expect(screen.getByTestId('day-cell-2026-10-12').getAttribute('aria-selected')).toBe('true');
  });

  it('labels a cell with the formatted date', async () => {
    const { localeReady } = setup();
    await localeReady;
    expect(screen.getByTestId('day-cell-2026-10-08').getAttribute('aria-label')).toBe(
      formatDate('2026-10-08', REGION_BD_EN),
    );
  });

  it('renders no header without onMonthChange', async () => {
    const { localeReady } = setup();
    await localeReady;
    expect(screen.queryByRole('button', { name: 'Today' })).toBeNull();
  });

  it('shows at most 3 dots for a busy day', async () => {
    const { localeReady } = setup({
      events: [ev('1'), ev('2'), ev('3'), ev('4')],
      onDayClick: vi.fn(),
    });
    await localeReady;
    const cell = screen.getByTestId('day-cell-2026-10-08');
    expect(cell.querySelectorAll('div[aria-hidden="true"] > span')).toHaveLength(3);
    expect(within(cell).getByText('+1 more')).toBeTruthy();
  });

  it('keeps event buttons instead of dots when a day tap leads nowhere', async () => {
    const onEventClick = vi.fn();
    const { user, localeReady } = setup({ events: [ev('1')], onEventClick });
    await localeReady;
    const cell = screen.getByTestId('day-cell-2026-10-08');
    expect(cell.querySelectorAll('div[aria-hidden="true"] > span')).toHaveLength(0);
    await user.click(within(cell).getByRole('button', { name: 'Event 1' }));
    expect(onEventClick).toHaveBeenCalledWith('1');
  });

  it('keeps one day tabbable after the month changes', async () => {
    const { rerender, localeReady } = setup({ selectedDate: '2026-10-20' });
    await localeReady;
    rerender(
      <RegionConfigProvider value={REGION_BD_EN}>
        <MonthGrid {...BASE} month="2026-12" selectedDate="2026-10-20" />
      </RegionConfigProvider>,
    );
    const tabbable = screen
      .getAllByRole('gridcell')
      .filter((cell) => cell.getAttribute('tabindex') === '0');
    expect(tabbable).toHaveLength(1);
  });
});
