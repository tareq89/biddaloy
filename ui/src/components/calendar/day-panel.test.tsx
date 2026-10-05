import { CalendarEventType } from '@biddaloy/shared';
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { REGION_BD_EN, RegionConfigProvider } from '../../i18n';
import { renderWithProviders } from '../../test/render-with-providers';
import { formatDate, formatDateRange } from '../../utils/date';

import { DayPanel } from './day-panel';
import type { MonthGridEvent } from './month-grid';

function ev(id: string, over: Partial<MonthGridEvent> = {}): MonthGridEvent {
  return {
    id,
    type: CalendarEventType.EVENT,
    typeLabel: 'Event',
    name: `Event ${id}`,
    startDate: '2026-10-08',
    endDate: '2026-10-08',
    ...over,
  };
}

async function setup(events: MonthGridEvent[], onEventClick?: (id: string) => void) {
  const view = renderWithProviders(
    <RegionConfigProvider value={REGION_BD_EN}>
      <DayPanel date="2026-10-08" events={events} {...(onEventClick && { onEventClick })} />
    </RegionConfigProvider>,
    { locale: 'en' },
  );
  await view.localeReady;
  return view;
}

describe('DayPanel', () => {
  it('titles with the formatted date and shows the empty sentence', async () => {
    await setup([]);
    expect(
      screen.getByRole('heading', { name: formatDate('2026-10-08', REGION_BD_EN) }),
    ).toBeTruthy();
    expect(screen.getByText(/0 events/)).toBeTruthy();
    expect(screen.getByText('No events on this day.')).toBeTruthy();
  });

  it('pluralises the count', async () => {
    await setup([ev('1')]);
    expect(screen.getByText(/1 event$/)).toBeTruthy();
  });

  it('counts two events', async () => {
    await setup([ev('1'), ev('2')]);
    expect(screen.getByText(/2 events/)).toBeTruthy();
  });

  it('uses the range for a multi-day event', async () => {
    await setup([ev('1', { endDate: '2026-10-10' })]);
    const range = formatDateRange('2026-10-08', '2026-10-10', REGION_BD_EN);
    expect(screen.getByText(`${range} · Event`)).toBeTruthy();
  });

  it('calls onEventClick with the id and shows the badge', async () => {
    const onEventClick = vi.fn();
    const { user } = await setup([ev('1', { badge: <span>Draft</span> })], onEventClick);
    await user.click(screen.getByRole('button', { name: 'Event 1' }));
    expect(onEventClick).toHaveBeenCalledWith('1');
    expect(screen.getByText('Draft')).toBeTruthy();
  });
});
