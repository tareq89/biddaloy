import '@biddaloy/ui/test';

import { toast } from '@biddaloy/ui/components';
import { REGION_BD_BN } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { schoolFactory } from '@biddaloy/ui/test';
import { formatNumber, formatTime } from '@biddaloy/ui/utils';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PeriodSlotsPanel } from './period-slots-panel';

const ROW1 = formatNumber(1, REGION_BD_BN);
const ROW2 = formatNumber(2, REGION_BD_BN);
const SCHOOL_ID = 'school-1';

const TENANT = schoolFactory({ id: SCHOOL_ID });

const SHIFT = {
  id: 'shift-1',
  tenant: TENANT,
  tenant_id: SCHOOL_ID,
  name: 'Morning',
  day_starts_at: '08:00',
  day_ends_at: '16:00',
  sequence: 0,
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-01T00:00:00.000Z',
  deleted_at: null,
};

const MATH = {
  id: 's1',
  shift_id: 'shift-1',
  sequence: 0,
  kind: 'CLASS',
  name: 'Math',
  starts_at: '08:00',
  ends_at: '08:40',
};

function mockSlots(slots: unknown[]) {
  server.use(http.get('*/routines/shifts/shift-1/period-slots', () => HttpResponse.json(slots)));
}

function renderPanel(props: Partial<React.ComponentProps<typeof PeriodSlotsPanel>> = {}) {
  return renderWithProviders(
    <PeriodSlotsPanel
      shifts={[SHIFT]}
      shift={SHIFT}
      onSelectShift={vi.fn()}
      changeoverGapMinutes={5}
      {...props}
    />,
    { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID },
  );
}

const saveButton = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Save' });

describe('PeriodSlotsPanel', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows an empty state when there is no shift', async () => {
    renderPanel({ shifts: [], shift: undefined });

    expect(await screen.findByRole('heading', { name: 'Add a shift first' })).toBeTruthy();
  });

  it('has a labelled shift Select that calls onSelectShift, and no native select or time input', async () => {
    mockSlots([MATH]);
    const onSelectShift = vi.fn();
    const other = { ...SHIFT, id: 'shift-2', name: 'Evening' };
    const { container } = renderPanel({ shifts: [SHIFT, other], onSelectShift });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('combobox', { name: 'Shift' }));
    await user.click(await screen.findByRole('option', { name: 'Evening' }));

    expect(onSelectShift).toHaveBeenCalledWith('shift-2');
    expect(container.querySelector('select')).toBeNull();
    expect(container.querySelector('input[type="time"]')).toBeNull();
  });

  it('"Add period" appends a row starting at the previous end plus the changeover gap (D7)', async () => {
    mockSlots([MATH]);
    renderPanel();
    const user = userEvent.setup();

    await screen.findAllByRole('combobox', { name: `Starts, row ${ROW1}` });
    await user.click(screen.getByRole('button', { name: 'Add period' }));

    // 08:40 end + 5 minute gap = 08:45 (shown in the tenant's time format).
    await waitFor(() =>
      expect(
        screen.getAllByRole('combobox', { name: `Starts, row ${ROW2}` }).length,
      ).toBeGreaterThan(0),
    );
    const start = screen.getAllByRole<HTMLInputElement>('combobox', {
      name: `Starts, row ${ROW2}`,
    })[0]!;
    expect(start.value).toBe(formatTime('08:45', REGION_BD_BN));
  });

  it('clears stale rows and disables Save while a newly selected shift is still loading', async () => {
    const SHIFT_B = { ...SHIFT, id: 'shift-2', name: 'Evening' };
    mockSlots([MATH]);
    let resolveShiftB: (() => void) | undefined;
    server.use(
      http.get(
        '*/routines/shifts/shift-2/period-slots',
        () =>
          new Promise((resolve) => {
            resolveShiftB = () => resolve(HttpResponse.json([]));
          }),
      ),
    );

    const { rerender } = renderPanel({ shifts: [SHIFT, SHIFT_B] });

    await screen.findAllByRole('combobox', { name: `Starts, row ${ROW1}` });
    expect(saveButton().disabled).toBe(false);

    rerender(
      <PeriodSlotsPanel
        shifts={[SHIFT, SHIFT_B]}
        shift={SHIFT_B}
        onSelectShift={vi.fn()}
        changeoverGapMinutes={5}
      />,
    );

    // Shift B's fetch hasn't resolved yet — shift A's row must not still be
    // on screen, and Save must be disabled so a click can't PUT shift A's
    // rows onto shift B's period-slots endpoint.
    await waitFor(() =>
      expect(screen.queryByRole('combobox', { name: `Starts, row ${ROW1}` })).toBeNull(),
    );
    expect(saveButton().disabled).toBe(true);

    resolveShiftB?.();
    await waitFor(() => expect(saveButton().disabled).toBe(false));
  });

  it('a break keeps its name and the saved payload carries it', async () => {
    mockSlots([
      MATH,
      {
        ...MATH,
        id: 's2',
        sequence: 1,
        kind: 'BREAK',
        name: 'Tiffin',
        starts_at: '08:45',
        ends_at: '09:00',
      },
    ]);
    let body: { slots: { kind: string; name: string | null }[] } | null = null;
    server.use(
      http.put('*/routines/shifts/shift-1/period-slots', async ({ request }) => {
        body = (await request.json()) as typeof body;
        return HttpResponse.json([]);
      }),
    );
    renderPanel();
    const user = userEvent.setup();

    const names = await screen.findAllByLabelText(`Name, row ${ROW2}`);
    expect((names[0] as HTMLInputElement).value).toBe('Tiffin');

    // Turn row 1 into a break: its name stays.
    await user.click(screen.getAllByRole('combobox', { name: `Kind, row ${ROW1}` })[0]!);
    await user.click(await screen.findByRole('option', { name: 'Break' }));
    await user.click(saveButton());

    await waitFor(() => expect(body).not.toBeNull());
    expect(body!.slots[0]).toMatchObject({ kind: 'BREAK', name: 'Math' });
    expect(body!.slots[1]).toMatchObject({ kind: 'BREAK', name: 'Tiffin' });
  });

  it.each([
    ['ends before it starts', { starts_at: '09:00', ends_at: '08:50' }, 'Ends before it starts.'],
    [
      'sits outside the shift',
      { starts_at: '06:00', ends_at: '06:40' },
      /Keep it inside the shift/,
    ],
  ])('a row that %s shows its problem and disables Save', async (_label, times, message) => {
    mockSlots([{ ...MATH, ...times }]);
    renderPanel();

    expect((await screen.findAllByText(message)).length).toBeGreaterThan(0);
    expect(saveButton().disabled).toBe(true);
  });

  it('a row that starts before the row above ends shows the overlap message', async () => {
    mockSlots([MATH, { ...MATH, id: 's2', sequence: 1, starts_at: '08:30', ends_at: '09:10' }]);
    renderPanel();

    expect(
      (await screen.findAllByText('Starts before the row above ends.')).length,
    ).toBeGreaterThan(0);
    expect(saveButton().disabled).toBe(true);
  });

  it('a 409 on save shows the translated sentence, never the server text', async () => {
    mockSlots([MATH]);
    server.use(
      http.put('*/routines/shifts/shift-1/period-slots', () =>
        HttpResponse.json(
          {
            statusCode: 409,
            message: 'Cannot replace period slots: 4 routine slot(s) use them',
            timestamp: new Date().toISOString(),
            path: '/routines/shifts/shift-1/period-slots',
            requestId: 'req-1',
          },
          { status: 409 },
        ),
      ),
    );
    const errorSpy = vi.spyOn(toast, 'error').mockImplementation(() => '');
    try {
      renderPanel();
      const user = userEvent.setup();
      await screen.findAllByRole('combobox', { name: `Starts, row ${ROW1}` });
      await user.click(saveButton());

      await waitFor(() =>
        expect(errorSpy).toHaveBeenCalledWith(
          "Periods of this shift are already placed in a routine, so their times can't be replaced. Remove those periods from the class routine first.",
        ),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('numbers rows 1..n: a loaded 0-based set is shifted and a new row continues the count', async () => {
    mockSlots([
      { ...MATH, sequence: 0 },
      { ...MATH, id: 's2', sequence: 1, starts_at: '08:45', ends_at: '09:25' },
    ]);
    let body: { slots: { sequence: number }[] } | null = null;
    server.use(
      http.put('*/routines/shifts/shift-1/period-slots', async ({ request }) => {
        body = (await request.json()) as typeof body;
        return HttpResponse.json([]);
      }),
    );
    renderPanel();
    const user = userEvent.setup();

    await screen.findAllByRole('combobox', { name: `Starts, row ${ROW2}` });
    await user.click(screen.getByRole('button', { name: 'Add period' }));
    // Phone heading for the new row names Period 3, never Period 0.
    expect(
      await screen.findByText(
        `Period ${formatNumber(3, REGION_BD_BN)} · row ${formatNumber(3, REGION_BD_BN)}`,
      ),
    ).toBeTruthy();
    await user.click(saveButton());

    await waitFor(() => expect(body).not.toBeNull());
    expect(body!.slots.map((slot) => slot.sequence)).toEqual([1, 2, 3]);
  });
});
