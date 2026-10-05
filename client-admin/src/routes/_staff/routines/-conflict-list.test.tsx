import { renderWithProviders } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ConflictList } from './-conflict-list';

describe('ConflictList', () => {
  it('renders nothing when there is nothing to show', () => {
    const { container } = renderWithProviders(<ConflictList violations={[]} />, { locale: 'en' });
    expect(container.textContent).toBe('');
  });

  it('lists every violation by its code sentence, never the server message', async () => {
    renderWithProviders(
      <ConflictList
        violations={[
          {
            code: 'TEACHER_DOUBLE_BOOKED',
            message: 'Ms Nahar is already teaching 7B at this time',
          },
          { code: 'ROOM_DOUBLE_BOOKED', message: 'Room 204 is already booked at this time' },
        ]}
      />,
      { locale: 'en' },
    );
    await waitFor(() =>
      expect(
        screen.getByText(
          'A teacher on this period is already teaching another section at this time.',
        ),
      ).toBeTruthy(),
    );
    expect(screen.getByText('This room is already in use at this time.')).toBeTruthy();
    expect(screen.queryByText(/Ms Nahar/)).toBeNull();
    expect(screen.queryByText(/Room 204/)).toBeNull();
  });

  it('shows one sentence per code and the fallback for an unknown code', async () => {
    renderWithProviders(
      <ConflictList
        violations={[
          { code: 'BREAK_SLOT', message: 'a' },
          { code: 'BREAK_SLOT', message: 'b' },
          { code: 'SOMETHING_NEW' as 'BREAK_SLOT', message: 'c' },
        ]}
      />,
      { locale: 'en' },
    );
    await waitFor(() =>
      expect(screen.getAllByText("A period can't go into a break.")).toHaveLength(1),
    );
    expect(screen.getByText('This breaks one of the routine rules.')).toBeTruthy();
  });

  it('renders warnings separately from violations', async () => {
    renderWithProviders(
      <ConflictList
        violations={[]}
        warnings={[{ code: 'TEACHER_NOT_ASSIGNED', message: 'Mr Karim is not assigned to Math' }]}
      />,
      { locale: 'en' },
    );
    await waitFor(() =>
      expect(
        screen.getByText("This teacher isn't assigned to this subject for this section."),
      ).toBeTruthy(),
    );
    expect(screen.queryByText('Mr Karim is not assigned to Math')).toBeNull();
    expect(screen.queryByText(/can't be saved/i)).toBeNull();
  });
});
