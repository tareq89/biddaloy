import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { i18n, REGION_BD_EN, RegionConfigProvider } from '../i18n';
import { renderWithProviders } from '../test';
import { formatDate, formatWeekday } from '../utils/date';

import { RoutineAgenda, type RoutineAgendaDay } from './routine-agenda';

async function renderInEnglish(ui: React.ReactElement) {
  const view = renderWithProviders(
    <RegionConfigProvider value={REGION_BD_EN}>{ui}</RegionConfigProvider>,
    { locale: 'en' },
  );
  await act(async () => {
    await view.localeReady;
    await i18n.loadNamespaces(['routines', 'common']);
  });
  return view;
}

const NORMAL_DAY: RoutineAgendaDay = {
  date: '2026-09-23',
  weekdayLabel: 'Wed',
  isToday: true,
  items: [
    {
      slotId: 'slot-1',
      periodLabel: 'Period 1',
      startsAt: '10:00',
      endsAt: '10:40',
      sectionLabel: 'Class 6A',
      subjectLabel: 'English',
      roomLabel: 'Room 12',
      cancelled: false,
    },
  ],
};

const COVERING_DAY: RoutineAgendaDay = {
  date: '2026-09-24',
  weekdayLabel: 'Thu',
  isToday: false,
  items: [
    {
      slotId: 'slot-2',
      periodLabel: 'Period 2',
      startsAt: '10:40',
      endsAt: '11:20',
      subjectLabel: 'Math',
      roomLabel: null,
      cancelled: false,
      coveringForLabel: 'Covering for Ms Nahar',
    },
    {
      slotId: 'slot-3',
      periodLabel: 'Period 3',
      startsAt: '11:20',
      endsAt: '12:00',
      subjectLabel: 'Science',
      roomLabel: null,
      cancelled: true,
    },
  ],
};

const HOLIDAY_DAY: RoutineAgendaDay = {
  date: '2026-09-25',
  weekdayLabel: 'Fri',
  isToday: false,
  offReason: 'Holiday — Eid ul-Fitr',
  items: [],
};

const EMPTY_DAY: RoutineAgendaDay = {
  date: '2026-09-26',
  weekdayLabel: 'Sat',
  isToday: false,
  items: [],
};

describe('RoutineAgenda', () => {
  it("renders a normal day's row: time column, subject, then section · period · room", async () => {
    await renderInEnglish(
      <RoutineAgenda
        days={[NORMAL_DAY]}
        selectedDate={NORMAL_DAY.date}
        onSelectDate={vi.fn()}
        weekView={false}
        onToggleWeekView={vi.fn()}
      />,
    );
    expect(screen.getByText('English')).toBeTruthy();
    expect(screen.getByText('Class 6A · Period 1 · Room 12')).toBeTruthy();
    expect(screen.getByText('10:00 AM')).toBeTruthy();
    expect(screen.getByText('until 10:40 AM')).toBeTruthy();
  });

  it('titles the card with weekday and date and counts the periods', async () => {
    await renderInEnglish(
      <RoutineAgenda
        days={[COVERING_DAY]}
        selectedDate={COVERING_DAY.date}
        onSelectDate={vi.fn()}
        weekView={false}
        onToggleWeekView={vi.fn()}
      />,
    );
    const title = `${formatWeekday(COVERING_DAY.date, REGION_BD_EN)}, ${formatDate(COVERING_DAY.date, REGION_BD_EN)}`;
    expect(screen.getByRole('heading', { name: title })).toBeTruthy();
    expect(screen.getByText('2 periods')).toBeTruthy();
  });

  it('marks today and the selected tab', async () => {
    await renderInEnglish(
      <RoutineAgenda
        days={[NORMAL_DAY, COVERING_DAY]}
        selectedDate={NORMAL_DAY.date}
        onSelectDate={vi.fn()}
        weekView={false}
        onToggleWeekView={vi.fn()}
      />,
    );
    const [todayTab, otherTab] = screen.getAllByRole('tab');
    expect(todayTab?.getAttribute('aria-selected')).toBe('true');
    expect(otherTab?.getAttribute('aria-selected')).toBe('false');
    expect(todayTab?.textContent).toBe('Today');
    expect(otherTab?.textContent).toBe('Thu 24');
  });

  it('keeps aria-pressed on the week toggle', async () => {
    await renderInEnglish(
      <RoutineAgenda
        days={[NORMAL_DAY]}
        selectedDate={NORMAL_DAY.date}
        onSelectDate={vi.fn()}
        weekView
        onToggleWeekView={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { pressed: true })).toBeTruthy();
  });

  it('marks a covering period and shows a cancelled one as cancelled, not hidden', async () => {
    await renderInEnglish(
      <RoutineAgenda
        days={[COVERING_DAY]}
        selectedDate={COVERING_DAY.date}
        onSelectDate={vi.fn()}
        weekView={false}
        onToggleWeekView={vi.fn()}
      />,
    );
    expect(screen.getByText('Covering for Ms Nahar')).toBeTruthy();
    // The cancelled slot's subject still renders (never hidden)…
    expect(screen.getByText('Science')).toBeTruthy();
    // …and is explicitly labelled cancelled.
    expect(screen.getByText('Cancelled')).toBeTruthy();
  });

  it('shows a holiday/weekly-off day\'s reason, not a bare "no classes"', async () => {
    await renderInEnglish(
      <RoutineAgenda
        days={[HOLIDAY_DAY]}
        selectedDate={HOLIDAY_DAY.date}
        onSelectDate={vi.fn()}
        weekView={false}
        onToggleWeekView={vi.fn()}
      />,
    );
    expect(screen.getByText('Holiday — Eid ul-Fitr')).toBeTruthy();
    expect(screen.queryByText('No classes.')).toBeNull();
  });

  it('shows the generic empty state for a genuinely empty working day', async () => {
    await renderInEnglish(
      <RoutineAgenda
        days={[EMPTY_DAY]}
        selectedDate={EMPTY_DAY.date}
        onSelectDate={vi.fn()}
        weekView={false}
        onToggleWeekView={vi.fn()}
      />,
    );
    expect(screen.getByText('No classes.')).toBeTruthy();
  });

  it('lets a day switcher tab select a different day', async () => {
    const onSelectDate = vi.fn();
    await renderInEnglish(
      <RoutineAgenda
        days={[NORMAL_DAY, COVERING_DAY]}
        selectedDate={NORMAL_DAY.date}
        onSelectDate={onSelectDate}
        weekView={false}
        onToggleWeekView={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Thu 24' }));
    expect(onSelectDate).toHaveBeenCalledWith(COVERING_DAY.date);
  });

  it('week view renders every day at once', async () => {
    await renderInEnglish(
      <RoutineAgenda
        days={[NORMAL_DAY, HOLIDAY_DAY]}
        selectedDate={NORMAL_DAY.date}
        onSelectDate={vi.fn()}
        weekView
        onToggleWeekView={vi.fn()}
      />,
    );
    expect(screen.getByText('Class 6A · Period 1 · Room 12')).toBeTruthy();
    expect(screen.getByText('Holiday — Eid ul-Fitr')).toBeTruthy();
  });

  it('is a list, not a table, at every width — never a grid element', async () => {
    const { container } = await renderInEnglish(
      <RoutineAgenda
        days={[NORMAL_DAY]}
        selectedDate={NORMAL_DAY.date}
        onSelectDate={vi.fn()}
        weekView={false}
        onToggleWeekView={vi.fn()}
      />,
    );
    expect(container.querySelector('table')).toBeNull();
  });
});
