import { renderWithProviders } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ConflictList } from './-conflict-list';

describe('ConflictList', () => {
  it('renders nothing when there is nothing to show', () => {
    const { container } = renderWithProviders(<ConflictList violations={[]} />, { locale: 'en' });
    expect(container.textContent).toBe('');
  });

  it('lists every violation, not just the first', async () => {
    renderWithProviders(
      <ConflictList
        violations={[
          { code: 'TEACHER_DOUBLE_BOOKED', message: 'Ms Nahar is already teaching 7B at this time' },
          { code: 'ROOM_DOUBLE_BOOKED', message: 'Room 204 is already booked at this time' },
        ]}
      />,
      { locale: 'en' },
    );
    await waitFor(() =>
      expect(screen.getByText('Ms Nahar is already teaching 7B at this time')).toBeTruthy(),
    );
    expect(screen.getByText('Room 204 is already booked at this time')).toBeTruthy();
  });

  it('renders warnings separately from violations', async () => {
    renderWithProviders(
      <ConflictList
        violations={[]}
        warnings={[{ code: 'TEACHER_NOT_ASSIGNED', message: 'Mr Karim is not assigned to Math' }]}
      />,
      { locale: 'en' },
    );
    await waitFor(() => expect(screen.getByText('Mr Karim is not assigned to Math')).toBeTruthy());
    expect(screen.queryByText(/can't be saved/i)).toBeNull();
  });
});
