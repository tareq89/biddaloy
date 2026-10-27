/**
 * Government holidays dialog: entries dated before `today` are shown
 * disabled with "Date has passed" and can't be ticked, so a bulk add never
 * includes a past date.
 */
import type { PublicHolidayEntry } from '@biddaloy/ui/hooks';
import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GovernmentHolidaysDialog } from './-government-holidays-dialog';

const SUGGESTIONS = [
  { id: 'past-1', name: 'Old Day', name_bn: null, date: '2026-01-10', end_date: '2026-01-10' },
  { id: 'future-1', name: 'New Day', name_bn: null, date: '2026-12-10', end_date: '2026-12-10' },
] as unknown as PublicHolidayEntry[];

describe('calendar/-government-holidays-dialog', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('disables a past row and adds only the ticked future one', async () => {
    const onAdd = vi.fn();
    const { localeReady } = renderWithProviders(
      <GovernmentHolidaysDialog
        open
        onOpenChange={vi.fn()}
        suggestions={SUGGESTIONS}
        existingEvents={[]}
        isPending={false}
        onAdd={onAdd}
        today="2026-06-01"
      />,
      { locale: 'en', role: 'ADMIN', tenantId: 'tenant-1' },
    );
    await localeReady;

    const user = userEvent.setup();
    expect(await screen.findByText('Date has passed')).toBeTruthy();
    const past = screen.getByRole('checkbox', { name: /Old Day/ });
    expect(past.hasAttribute('disabled')).toBe(true);

    await user.click(screen.getByRole('checkbox', { name: /New Day/ }));
    await user.click(screen.getByRole('button', { name: /^Add/ }));
    expect(onAdd).toHaveBeenCalledWith(['future-1']);
  });
});
