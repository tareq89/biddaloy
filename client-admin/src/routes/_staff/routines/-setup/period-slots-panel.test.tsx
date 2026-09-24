import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { schoolFactory } from '@biddaloy/ui/test';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { PeriodSlotsPanel } from './period-slots-panel';

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

function inputValue(element: HTMLElement): string {
  return (element as HTMLInputElement).value;
}

describe('PeriodSlotsPanel', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('prompts to pick a shift when none is selected', async () => {
    renderWithProviders(<PeriodSlotsPanel shift={undefined} changeoverGapMinutes={5} />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: SCHOOL_ID,
    });

    expect(
      await screen.findByText('Add a shift above, then pick it to edit its period slots.'),
    ).toBeTruthy();
  });

  it('Enter in the last row appends a slot pre-filled with the changeover gap, still editable', async () => {
    server.use(
      http.get('*/routines/shifts/shift-1/period-slots', () =>
        HttpResponse.json([
          {
            id: 's1',
            shift_id: 'shift-1',
            sequence: 0,
            kind: 'CLASS',
            name: 'Math',
            starts_at: '08:00',
            ends_at: '08:40',
          },
        ]),
      ),
    );

    renderWithProviders(<PeriodSlotsPanel shift={SHIFT} changeoverGapMinutes={5} />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: SCHOOL_ID,
    });

    const endsAtInputs = await screen.findAllByLabelText('Ends at');
    expect(endsAtInputs).toHaveLength(1);
    fireEvent.keyDown(endsAtInputs[0]!, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.getAllByLabelText('Ends at')).toHaveLength(2);
    });
    // 08:40 ends_at + 5 minute changeover gap = 08:45 starts_at (D7).
    const startsAtInputs = screen.getAllByLabelText('Starts at');
    expect(inputValue(startsAtInputs[1]!)).toBe('08:45');

    // Still editable — a manual edit is never overridden.
    fireEvent.change(startsAtInputs[1]!, { target: { value: '09:00' } });
    expect(inputValue(startsAtInputs[1]!)).toBe('09:00');
  });

  it('clears stale rows and disables Save while a newly selected shift is still loading', async () => {
    const SHIFT_B = { ...SHIFT, id: 'shift-2', name: 'Evening' };
    server.use(
      http.get('*/routines/shifts/shift-1/period-slots', () =>
        HttpResponse.json([
          {
            id: 's1',
            shift_id: 'shift-1',
            sequence: 0,
            kind: 'CLASS',
            name: 'Math',
            starts_at: '08:00',
            ends_at: '08:40',
          },
        ]),
      ),
    );
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

    const { rerender } = renderWithProviders(
      <PeriodSlotsPanel shift={SHIFT} changeoverGapMinutes={5} />,
      { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID },
    );

    await screen.findAllByLabelText('Starts at');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save' }).disabled).toBe(false);

    rerender(<PeriodSlotsPanel shift={SHIFT_B} changeoverGapMinutes={5} />);

    // Shift B's fetch hasn't resolved yet — shift A's row must not still be
    // on screen, and Save must be disabled so a click can't PUT shift A's
    // rows onto shift B's period-slots endpoint.
    await waitFor(() => expect(screen.queryByLabelText('Starts at')).toBeNull());
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save' }).disabled).toBe(true);

    resolveShiftB?.();
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save' }).disabled).toBe(false),
    );
  });

  it('BREAK rows hide the name field', async () => {
    server.use(
      http.get('*/routines/shifts/shift-1/period-slots', () =>
        HttpResponse.json([
          {
            id: 's1',
            shift_id: 'shift-1',
            sequence: 0,
            kind: 'BREAK',
            name: null,
            starts_at: '10:00',
            ends_at: '10:15',
          },
        ]),
      ),
    );

    renderWithProviders(<PeriodSlotsPanel shift={SHIFT} changeoverGapMinutes={5} />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: SCHOOL_ID,
    });

    await screen.findAllByLabelText('Starts at');
    expect(screen.queryByLabelText('Name')).toBeNull();
  });
});
