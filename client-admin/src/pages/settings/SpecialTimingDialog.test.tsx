import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SpecialTimingDialog, type SpecialTiming } from './SpecialTimingDialog';
import { WithTestRouter } from './with-test-router';

const SHIFTS = [{ id: 'sh-1', name: 'Morning' }];
const EXISTING: SpecialTiming = {
  name: 'Ramadan',
  from: '2027-02-08',
  to: '2027-03-09',
  shiftId: 'sh-1',
  lateAfter: '08:45',
  absentAfter: '09:15',
  periods: [],
};

function renderDialog(props: Partial<React.ComponentProps<typeof SpecialTimingDialog>> = {}) {
  const onSave = vi.fn();
  server.use(
    http.get('*/routines/shifts/:id/period-slots', () =>
      HttpResponse.json([
        {
          id: 'p1',
          sequence: 1,
          kind: 'CLASS',
          name: null,
          starts_at: '08:00:00',
          ends_at: '08:45:00',
        },
        {
          id: 'p2',
          sequence: 2,
          kind: 'CLASS',
          name: null,
          starts_at: '08:45:00',
          ends_at: '09:30:00',
        },
      ]),
    ),
  );
  const result = renderWithProviders(
    <WithTestRouter>
      <SpecialTimingDialog
        open
        onOpenChange={() => {}}
        shifts={SHIFTS}
        shiftsWithOwnTimes={[]}
        others={[]}
        schoolLateAfter="09:00"
        schoolAbsentAfter="09:30"
        onSave={onSave}
        {...props}
      />
    </WithTestRouter>,
    { locale: 'en', role: 'ADMIN', tenantId: 'school-1' },
  );
  return { ...result, onSave };
}

describe('SpecialTimingDialog', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('requires name and both dates', async () => {
    const { user, onSave } = renderDialog();
    await user.click(await screen.findByRole('button', { name: 'Save timing' }));
    expect(await screen.findByText('Enter a name.')).toBeTruthy();
    expect(screen.getAllByText('Pick a date.')).toHaveLength(2);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('rejects to-date before from-date', async () => {
    const { user, onSave } = renderDialog({
      initial: { ...EXISTING, shiftId: null, from: '2027-03-09', to: '2027-02-08' },
    });
    expect(
      await screen.findByText('The end date must be on or after the start date.'),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save timing' }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('refuses an overlap with another entry of the same shift', async () => {
    const { user, onSave } = renderDialog({
      initial: { ...EXISTING, name: 'Copy' },
      others: [{ ...EXISTING, from: '2027-03-01', to: '2027-03-31' }],
    });
    expect(
      await screen.findByText(
        'Another entry for the same shift already covers some of these dates.',
      ),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save timing' }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('period rows appear only for a single shift', async () => {
    renderDialog({ initial: { ...EXISTING, shiftId: null } });
    await screen.findByLabelText('Name');
    expect(screen.queryByRole('group', { name: '1' })).toBeNull();
  });

  it('saves only changed period rows', async () => {
    const { user, onSave } = renderDialog({
      initial: { ...EXISTING, periods: [{ sequence: 2, startsAt: '08:50', endsAt: '09:30' }] },
    });
    await screen.findByRole('group', { name: '1' });
    expect(screen.getByRole('group', { name: '2' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save timing' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]![0].periods).toEqual([
      { sequence: 2, startsAt: '08:50', endsAt: '09:30' },
    ]);
  });

  // F2: slots arrive as Postgres `HH:mm:ss`; the server's DTO only takes `HH:mm`.
  it('changing only the start saves HH:mm for both ends', async () => {
    const { user, onSave } = renderDialog({ initial: EXISTING });
    await screen.findByRole('group', { name: '1' });
    const start = screen.getByRole('combobox', { name: '1 — Starts' });
    await user.click(start);
    await user.clear(start); // the list is filtered by the current label until cleared
    await user.click((await screen.findAllByRole('option', { name: /^0?8:30\sAM$/ }))[0]!);
    await user.click(screen.getByRole('button', { name: 'Save timing' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]![0].periods).toEqual([
      { sequence: 1, startsAt: '08:30', endsAt: '08:45' },
    ]);
  });

  // F3: saving before the slots load would drop the saved period overrides.
  it('Save stays disabled until the shift period slots have loaded', async () => {
    renderDialog({
      initial: { ...EXISTING, periods: [{ sequence: 2, startsAt: '08:50', endsAt: '09:30' }] },
    });
    expect(await screen.findByRole('button', { name: 'Save timing' })).toHaveProperty(
      'disabled',
      true,
    );
    await screen.findByRole('group', { name: '1' });
    expect(screen.getByRole('button', { name: 'Save timing' })).toHaveProperty('disabled', false);
  });

  it('tells the admin an all-shifts entry skips shifts with their own times', async () => {
    renderDialog({ initial: { ...EXISTING, shiftId: null }, shiftsWithOwnTimes: ['sh-1'] });
    expect(
      await screen.findByText(/Shifts that have their own times are not changed/),
    ).toBeTruthy();
  });
});
