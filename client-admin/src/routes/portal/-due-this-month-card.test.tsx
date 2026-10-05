import { FeeStatus, FeeType, PeriodType } from '@biddaloy/shared';
import type { FeeDueEntry } from '@biddaloy/ui/hooks';
import { REGION_BD_EN } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DueThisMonthCard, DueThisMonthSection } from './-due-this-month-card';

/**
 * [38.4.5] `DueThisMonthCard` is a pure component — no query of its own —
 * so `now` is always passed explicitly rather than read from the real
 * clock, avoiding the time-of-day flake `portal/index.test.tsx` and
 * `fees.test.tsx` both call out from #361.
 *
 * `findByText`, not `getByText`: `renderWithProviders({ locale: 'en' })`
 * loads the `portal` i18n namespace lazily, same pattern
 * `admin-verification-modal.test.tsx` uses.
 */
describe('DueThisMonthCard', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  // A fixed instant well inside March 2026 — noon, not midnight, so a
  // component that (wrongly) compared full timestamps instead of
  // calendar months would still be caught by the "10th of this month"
  // case below.
  const now = new Date('2026-03-15T12:00:00.000Z');

  function due(overrides: Partial<FeeDueEntry> = {}): FeeDueEntry {
    return {
      student_fee_id: overrides.student_fee_id ?? 'due-1',
      fee_structure_id: 'structure-1',
      fee_name: 'Tuition',
      fee_type: FeeType.MONTHLY_TUITION,
      month: 3,
      year: 2026,
      period_start: '2026-03-01T00:00:00.000Z',
      period_type: PeriodType.MONTH,
      occurrence: 1,
      is_late_fee: false,
      is_fine: false,
      note: null,
      total_amount: 500,
      paid_amount: 0,
      discount_amount: 0,
      standing_discount_amount: 0,
      one_off_discount_amount: 0,
      balance: 500,
      status: FeeStatus.PENDING,
      due_date: '2026-03-10T00:00:00.000Z',
      reminder_threshold_date: null,
      ...overrides,
    };
  }

  it('shows a line due this month under the this-month list', async () => {
    renderWithProviders(
      <DueThisMonthCard
        dues={[due({ student_fee_id: 'this-month', due_date: '2026-03-10T00:00:00.000Z' })]}
        now={now}
        config={REGION_BD_EN}
      />,
      { locale: 'en' },
    );

    expect(await screen.findByText('Tuition')).toBeTruthy();
    expect(screen.getByText('Total to pay this month')).toBeTruthy();
    expect(screen.queryByText('Carried over')).toBeFalsy();
  });

  it('shows a still-unpaid line from last month under Carried over', async () => {
    renderWithProviders(
      <DueThisMonthCard
        dues={[
          due({
            student_fee_id: 'last-month',
            fee_name: 'February tuition',
            due_date: '2026-02-05T00:00:00.000Z',
          }),
        ]}
        now={now}
        config={REGION_BD_EN}
      />,
      { locale: 'en' },
    );

    expect(await screen.findByText('Carried over')).toBeTruthy();
    expect(screen.getByText('February tuition')).toBeTruthy();
  });

  it('shows the Fine badge and note on a fine row', async () => {
    renderWithProviders(
      <DueThisMonthCard
        dues={[
          due({
            student_fee_id: 'fine-1',
            fee_name: 'Late arrival fine',
            is_fine: true,
            note: 'Late to school 3 times',
            due_date: '2026-03-08T00:00:00.000Z',
          }),
        ]}
        now={now}
        config={REGION_BD_EN}
      />,
      { locale: 'en' },
    );

    expect(await screen.findByText('Late arrival fine')).toBeTruthy();
    expect(screen.getByText('Fine')).toBeTruthy();
    expect(screen.getByText('Late to school 3 times')).toBeTruthy();
  });

  it('renders "Nothing due this month" when nothing is outstanding', async () => {
    renderWithProviders(<DueThisMonthCard dues={[]} now={now} config={REGION_BD_EN} />, {
      locale: 'en',
    });

    expect(await screen.findByText('Nothing due this month')).toBeTruthy();
  });

  describe('DueThisMonthSection', () => {
    it('renders nothing for an empty list', async () => {
      const { container } = renderWithProviders(
        <DueThisMonthSection dues={[]} now={now} config={REGION_BD_EN} />,
        { locale: 'en' },
      );
      // Let the lazily-loaded namespace settle, then assert emptiness.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(container.querySelector('h4')).toBeNull();
      expect(screen.queryByText('Due this month')).toBeNull();
      expect(screen.queryByText('Nothing due this month')).toBeNull();
    });

    it('renders nothing when the only line is fully paid', async () => {
      renderWithProviders(
        <DueThisMonthSection dues={[due({ balance: 0 })]} now={now} config={REGION_BD_EN} />,
        { locale: 'en' },
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(screen.queryByText('Due this month')).toBeNull();
    });

    it('adds carried-over to this month in the total', async () => {
      renderWithProviders(
        <DueThisMonthSection
          dues={[
            due({ student_fee_id: 'a', balance: 500 }),
            due({
              student_fee_id: 'b',
              fee_name: 'February tuition',
              balance: 300,
              due_date: '2026-02-05T00:00:00.000Z',
            }),
          ]}
          now={now}
          config={REGION_BD_EN}
        />,
        { locale: 'en' },
      );

      const heading = await screen.findByRole('heading', { level: 4, name: 'Due this month' });
      const section = heading.parentElement as HTMLElement;
      expect(within(section).getByText('Carried over')).toBeTruthy();
      const totalRow = within(section).getByText('Total to pay this month').parentElement;
      expect(totalRow?.textContent).toContain('৳800.00');
    });
  });
});
