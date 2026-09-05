import { AttendanceStatus } from '@biddaloy/shared';
import { act, screen, within } from '@testing-library/react';
import type * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { i18n, REGION_BD_EN, RegionConfigProvider } from '../i18n';
import { renderWithProviders } from '../test';

import { AttendanceMonthGrid, type AttendanceDayCell } from './attendance-month-grid';

/** Preloads the `portal` namespace before mounting — same reasoning
 * `attendance-status-control.test.tsx`'s own `renderInEnglish` documents:
 * without this, `useTranslation('portal')` suspends on first use and an
 * immediate `screen.getByText` races the Suspense fallback.
 *
 * Wrapped in an explicit `RegionConfigProvider value={REGION_BD_EN}` —
 * `useRegionConfig()`'s context default is always `REGION_BD_BN`
 * (Bengali numerals) regardless of the active i18next locale (see that
 * context's own comment), so without this every date in this suite would
 * render Bengali digits even under `locale: 'en'`. */
async function renderInEnglish(ui: React.ReactElement) {
  const view = renderWithProviders(
    <RegionConfigProvider value={REGION_BD_EN}>{ui}</RegionConfigProvider>,
    {
      locale: 'en',
    },
  );
  await act(async () => {
    await view.localeReady;
    await i18n.loadNamespaces('portal');
  });
  return view;
}

function day(overrides: Partial<AttendanceDayCell> & { date: string }): AttendanceDayCell {
  return {
    status: null,
    isWorkingDay: true,
    holidayName: null,
    minutesLate: null,
    remarks: null,
    ...overrides,
  };
}

// September 2026: 30 days, 1st is a Tuesday (UTC weekday 2) — a month
// that isn't already aligned to Sunday, so a leading-blank bug can't hide
// behind a coincidence.
const SEPTEMBER_2026 = '2026-09';

// February 2027: 28 days, 1st is a Monday (UTC weekday 1) — the classic
// short-month off-by-one case, picked because its `firstDayOfWeek=0` and
// `firstDayOfWeek=1` leading-blank counts (1 and 0) are different from
// each other, so a test that only checked one could not silently pass
// while the other was broken.
const FEBRUARY_2027 = '2027-02';

describe('AttendanceMonthGrid', () => {
  it('renders all six visual states, each with an icon and a word', async () => {
    const days: AttendanceDayCell[] = [
      day({ date: '2026-09-01', status: AttendanceStatus.PRESENT }),
      day({ date: '2026-09-02', status: AttendanceStatus.LATE, minutesLate: 12 }),
      day({ date: '2026-09-03', status: AttendanceStatus.ABSENT }),
      day({ date: '2026-09-04', status: AttendanceStatus.LEAVE }),
      day({ date: '2026-09-05', isWorkingDay: false, holidayName: 'Independence Day' }),
      day({ date: '2026-09-06', status: null }),
    ];
    await renderInEnglish(
      <AttendanceMonthGrid month={SEPTEMBER_2026} days={days} onSelectDay={() => {}} />,
    );

    expect(screen.getByRole('button', { name: '2026-09-01 — Present' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '2026-09-02 — Late by 12 minutes' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '2026-09-03 — Absent' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '2026-09-04 — Leave' })).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: '2026-09-05 — Not a school day — Independence Day',
      }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: '2026-09-06 — Not marked' })).toBeTruthy();

    // The legend lists all six, always visible (not behind a disclosure).
    const legend = screen.getByText('Legend').closest('div') as HTMLElement;
    expect(within(legend).getByText('Present')).toBeTruthy();
    expect(within(legend).getByText('Late')).toBeTruthy();
    expect(within(legend).getByText('Absent')).toBeTruthy();
    expect(within(legend).getByText('Leave')).toBeTruthy();
    expect(within(legend).getByText('Not a school day')).toBeTruthy();
    expect(within(legend).getByText('Not marked')).toBeTruthy();
  });

  it('renders a missing day (short/incomplete `days` array) as Not marked instead of crashing', async () => {
    await renderInEnglish(
      <AttendanceMonthGrid
        month={SEPTEMBER_2026}
        days={[day({ date: '2026-09-01', status: AttendanceStatus.PRESENT })]}
        onSelectDay={() => {}}
      />,
    );

    expect(screen.getByRole('button', { name: '2026-09-01 — Present' })).toBeTruthy();
    // The 30th of September was never in the array at all.
    expect(screen.getByRole('button', { name: '2026-09-30 — Not marked' })).toBeTruthy();
  });

  it('tolerates a completely empty `days` array', async () => {
    await renderInEnglish(
      <AttendanceMonthGrid month={SEPTEMBER_2026} days={[]} onSelectDay={() => {}} />,
    );

    expect(screen.getByRole('button', { name: '2026-09-01 — Not marked' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '2026-09-30 — Not marked' })).toBeTruthy();
  });

  it('calls onSelectDay with the clicked day', async () => {
    const onSelectDay = vi.fn();
    const { user } = await renderInEnglish(
      <AttendanceMonthGrid
        month={SEPTEMBER_2026}
        days={[day({ date: '2026-09-03', status: AttendanceStatus.ABSENT })]}
        onSelectDay={onSelectDay}
      />,
    );

    await user.click(screen.getByRole('button', { name: '2026-09-03 — Absent' }));

    expect(onSelectDay).toHaveBeenCalledWith(
      expect.objectContaining({ date: '2026-09-03', status: AttendanceStatus.ABSENT }),
    );
  });

  it('renders plain (non-interactive) cells when `onSelectDay` is not given', async () => {
    await renderInEnglish(
      <AttendanceMonthGrid
        month={SEPTEMBER_2026}
        days={[day({ date: '2026-09-01', status: AttendanceStatus.PRESENT })]}
      />,
    );

    expect(screen.queryByRole('button', { name: /2026-09-01/ })).toBeNull();
    expect(screen.getByLabelText('2026-09-01 — Present')).toBeTruthy();
  });

  describe('firstDayOfWeek rotates the header AND the leading-blank count together', () => {
    it('September 2026 (starts Tuesday): 2 leading blanks at firstDayOfWeek=0', async () => {
      await renderInEnglish(
        <AttendanceMonthGrid month={SEPTEMBER_2026} days={[]} firstDayOfWeek={0} />,
      );
      const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
      expect(headers).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);

      // The *leading* blank count specifically — the first `<tr>`'s own
      // blank cells before day 1 lands — not the grid's total blank
      // count, which also includes the trailing cells that round the
      // last week out to 7 columns.
      const firstRow = document.querySelector('tbody tr') as HTMLElement;
      expect(firstRow.querySelectorAll('td[aria-hidden="true"]')).toHaveLength(2);
    });

    it('September 2026 (starts Tuesday): 1 leading blank at firstDayOfWeek=1', async () => {
      await renderInEnglish(
        <AttendanceMonthGrid month={SEPTEMBER_2026} days={[]} firstDayOfWeek={1} />,
      );
      const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
      expect(headers).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);

      const firstRow = document.querySelector('tbody tr') as HTMLElement;
      expect(firstRow.querySelectorAll('td[aria-hidden="true"]')).toHaveLength(1);
    });

    it('February 2027 (28 days, starts Monday): 1 leading blank at firstDayOfWeek=0', async () => {
      await renderInEnglish(
        <AttendanceMonthGrid
          month={FEBRUARY_2027}
          days={[]}
          firstDayOfWeek={0}
          onSelectDay={() => {}}
        />,
      );
      const blanks = document.querySelectorAll('td[aria-hidden="true"]');
      // 1 leading blank, and 28 real days fill exactly 4 full weeks after
      // it — 29 cells total, rounded up to 35 (5 rows), so 6 trailing.
      expect(blanks).toHaveLength(1 + 6);
      expect(screen.getByRole('button', { name: '2027-02-01 — Not marked' })).toBeTruthy();
      expect(screen.getByRole('button', { name: '2027-02-28 — Not marked' })).toBeTruthy();
    });

    it('February 2027 (28 days, starts Monday): 0 leading blanks at firstDayOfWeek=1', async () => {
      await renderInEnglish(
        <AttendanceMonthGrid month={FEBRUARY_2027} days={[]} firstDayOfWeek={1} />,
      );
      const blanks = document.querySelectorAll('td[aria-hidden="true"]');
      // 0 leading blanks, 28 days is exactly 4 full weeks — 0 trailing too.
      expect(blanks).toHaveLength(0);
    });
  });

  it('renders a loading skeleton in the same 7-column geometry, not the real grid', async () => {
    await renderInEnglish(<AttendanceMonthGrid month={SEPTEMBER_2026} days={[]} isLoading />);

    expect(screen.queryByRole('button')).toBeNull();
    // The whole skeleton table is `aria-hidden`, so its headers/cells are
    // queried directly rather than through `getByRole` (which correctly
    // excludes them from the accessibility tree).
    const table = document.querySelector('table[aria-hidden="true"]') as HTMLElement;
    expect(table.querySelectorAll('thead th')).toHaveLength(7);
    // Every populated row of the skeleton also has 7 cells.
    const rows = table.querySelectorAll('tbody tr');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.querySelectorAll('td')).toHaveLength(7);
    }
  });
});
