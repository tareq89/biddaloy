import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { REGION_BD_EN } from '../i18n/region-config';

import { DatePicker } from './date-picker';

function Controlled({ initial }: { initial?: Date }) {
  const [value, setValue] = useState<Date | undefined>(initial);
  return (
    <DatePicker
      aria-label="Enrollment date"
      value={value}
      onValueChange={setValue}
      config={REGION_BD_EN}
    />
  );
}

describe('DatePicker', () => {
  it('accepts a typed YYYY-MM-DD date without touching the calendar', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const input = screen.getByPlaceholderText('YYYY-MM-DD');
    await user.type(input, '2024-01-05');
    expect((input as HTMLInputElement).value).toBe('2024-01-05');
  });

  it('leaves an incomplete typed date as-is rather than rejecting mid-keystroke', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const input = screen.getByPlaceholderText('YYYY-MM-DD');
    await user.type(input, '2024-01');
    expect((input as HTMLInputElement).value).toBe('2024-01');
  });

  it('opens the calendar from the trigger button, keyboard-navigable, and selecting a day commits it and closes the popover', async () => {
    const user = userEvent.setup();
    render(<Controlled initial={new Date(2024, 0, 5)} />);

    await user.click(screen.getByRole('button', { name: 'Open calendar' }));
    const grid = await screen.findByRole('grid', { name: 'Calendar' });
    expect(grid).toBeTruthy();

    // The 5th (the current value) is the roving tab stop.
    const day5 = screen.getByRole('gridcell', { name: '5' });
    expect(day5.getAttribute('tabindex')).toBe('0');

    day5.focus();
    await user.keyboard('{ArrowRight}');
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('gridcell', { name: '6' })),
    );

    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('grid', { name: 'Calendar' })).toBeNull());

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- tsc disagrees with eslint's type resolution here; the cast is required for `.value` to typecheck under `tsc --noEmit`.
    const input = screen.getByPlaceholderText('YYYY-MM-DD') as HTMLInputElement;
    expect(input.value).toBe('2024-01-06');
  });

  it('crosses a month boundary when arrow-navigating past the end of the month', async () => {
    const user = userEvent.setup();
    render(<Controlled initial={new Date(2024, 0, 31)} />);
    await user.click(screen.getByRole('button', { name: 'Open calendar' }));
    await screen.findByRole('grid', { name: 'Calendar' });

    screen.getByRole('gridcell', { name: '31' }).focus();
    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(screen.getByText('2024-02')).toBeTruthy());
  });

  it('ArrowDown/ArrowUp move focus a week at a time, and clicking a day selects it directly', async () => {
    const user = userEvent.setup();
    render(<Controlled initial={new Date(2024, 0, 5)} />);
    await user.click(screen.getByRole('button', { name: 'Open calendar' }));
    await screen.findByRole('grid', { name: 'Calendar' });

    screen.getByRole('gridcell', { name: '5' }).focus();
    await user.keyboard('{ArrowDown}');
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('gridcell', { name: '12' })),
    );
    await user.keyboard('{ArrowUp}');
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('gridcell', { name: '5' })),
    );

    await user.click(screen.getByRole('gridcell', { name: '12' }));
    await waitFor(() => expect(screen.queryByRole('grid', { name: 'Calendar' })).toBeNull());
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- tsc disagrees with eslint's type resolution here; the cast is required for `.value` to typecheck under `tsc --noEmit`.
    const input = screen.getByPlaceholderText('YYYY-MM-DD') as HTMLInputElement;
    expect(input.value).toBe('2024-01-12');
  });

  it('the Previous/Next month buttons navigate the visible month', async () => {
    const user = userEvent.setup();
    render(<Controlled initial={new Date(2024, 0, 5)} />);
    await user.click(screen.getByRole('button', { name: 'Open calendar' }));
    await screen.findByRole('grid', { name: 'Calendar' });
    expect(screen.getByText('2024-01')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByText('2024-02')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(screen.getByText('2024-01')).toBeTruthy();
  });

  it('clearing the typed input commits undefined rather than leaving the last valid date', async () => {
    const user = userEvent.setup();
    render(<Controlled initial={new Date(2024, 0, 5)} />);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- tsc disagrees with eslint's type resolution here; the cast is required for `.value` to typecheck under `tsc --noEmit`.
    const input = screen.getByPlaceholderText('YYYY-MM-DD') as HTMLInputElement;
    expect(input.value).toBe('2024-01-05');

    await user.clear(input);
    expect(input.value).toBe('');
    // Reopening the calendar with nothing selected proves `value` actually
    // became `undefined`, not just that the text field looks empty.
    await user.click(screen.getByRole('button', { name: 'Open calendar' }));
    const grid = await screen.findByRole('grid', { name: 'Calendar' });
    expect(within(grid).queryByRole('gridcell', { selected: true })).toBeNull();
  });

  it('keeps DOM focus on a day cell after arrow-navigating across a month boundary', async () => {
    const user = userEvent.setup();
    render(<Controlled initial={new Date(2024, 0, 31)} />);
    await user.click(screen.getByRole('button', { name: 'Open calendar' }));
    await screen.findByRole('grid', { name: 'Calendar' });

    screen.getByRole('gridcell', { name: '31' }).focus();
    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(screen.getByText('2024-02')).toBeTruthy());
    await waitFor(() => expect(document.activeElement?.getAttribute('role')).toBe('gridcell'));
    expect(document.activeElement?.textContent).toBe('1');
  });

  it('keeps DOM focus on a day cell when arrow-navigating backward across a year boundary (Jan -> Dec)', async () => {
    const user = userEvent.setup();
    render(<Controlled initial={new Date(2024, 0, 1)} />);
    await user.click(screen.getByRole('button', { name: 'Open calendar' }));
    await screen.findByRole('grid', { name: 'Calendar' });

    screen.getByRole('gridcell', { name: '1' }).focus();
    await user.keyboard('{ArrowLeft}');
    await waitFor(() => expect(screen.getByText('2023-12')).toBeTruthy());
    await waitFor(() => expect(document.activeElement?.getAttribute('role')).toBe('gridcell'));
    expect(document.activeElement?.textContent).toBe('31');
  });

  it('supports custom Previous/Next month labels, e.g. for a non-English locale', async () => {
    const user = userEvent.setup();
    function ControlledWithLabels() {
      return (
        <DatePicker
          aria-label="Enrollment date"
          value={new Date(2024, 0, 5)}
          onValueChange={() => {}}
          config={REGION_BD_EN}
          previousMonthLabel="আগের মাস"
          nextMonthLabel="পরের মাস"
        />
      );
    }
    render(<ControlledWithLabels />);
    await user.click(screen.getByRole('button', { name: 'Open calendar' }));
    expect(await screen.findByRole('button', { name: 'পরের মাস' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'আগের মাস' })).toBeTruthy();
  });

  it('exposes weekday column headers in the calendar grid', async () => {
    const user = userEvent.setup();
    render(<Controlled initial={new Date(2024, 0, 5)} />);
    await user.click(screen.getByRole('button', { name: 'Open calendar' }));
    const grid = await screen.findByRole('grid', { name: 'Calendar' });
    const headers = within(grid).getAllByRole('columnheader');
    expect(headers).toHaveLength(7);
    expect(headers.map((header) => header.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('Sun')]),
    );
  });

  it('handles the Feb 29 leap-year boundary without losing a day', async () => {
    const user = userEvent.setup();
    render(<Controlled initial={new Date(2024, 1, 29)} />);
    await user.click(screen.getByRole('button', { name: 'Open calendar' }));
    const grid = await screen.findByRole('grid', { name: 'Calendar' });
    expect(within(grid).getByRole('gridcell', { name: '29' })).toBeTruthy();
    expect(within(grid).queryByRole('gridcell', { name: '30' })).toBeNull();
  });
});
