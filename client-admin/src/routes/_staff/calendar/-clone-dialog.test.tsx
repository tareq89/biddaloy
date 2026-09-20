/**
 * [17.5.3] "Clone from another year" dialog — rendered directly, not
 * through a route of its own, matching fees/schedules'
 * `-clone-dialog.test.tsx` precedent for a modal with no route to mount
 * through. Unlike that one, this dialog has no HTTP call of its own — the
 * caller (`index.tsx`) owns the `POST /calendar/clone` request — so these
 * tests only exercise the picker/submit-gating behaviour via props.
 *
 * `renderWithProviders`'s `locale: 'en'` change is async, and this
 * namespace (`calendarImport`) isn't otherwise loaded in these tests, so
 * every render awaits `localeReady` before the first query — otherwise
 * the very first assertion can race the language switch and see `bn`.
 */
import type { AcademicYear } from '@biddaloy/ui/hooks';
import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CloneDialog } from './-clone-dialog';

const YEARS = [
  { id: 'year-1', name: '2026-2027', start_date: '2026-01-01', end_date: '2026-12-31' },
  { id: 'year-2', name: '2027-2028', start_date: '2027-01-01', end_date: '2027-12-31' },
] as unknown as AcademicYear[];

describe('calendar/-clone-dialog', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('keeps submit disabled until both a source and a different target year are picked', async () => {
    const onSubmit = vi.fn();
    const { localeReady } = renderWithProviders(
      <CloneDialog
        open
        onOpenChange={vi.fn()}
        academicYears={YEARS}
        isPending={false}
        onSubmit={onSubmit}
      />,
      { locale: 'en', role: 'ADMIN', tenantId: 'tenant-1' },
    );
    await localeReady;

    const user = userEvent.setup();
    expect(
      (await screen.findByRole('button', { name: 'Preview clone' })).hasAttribute('disabled'),
    ).toBe(true);

    await user.click(screen.getByRole('combobox', { name: 'Copy from' }));
    await user.click(await screen.findByRole('option', { name: '2026-2027' }));
    expect(screen.getByRole('button', { name: 'Preview clone' }).hasAttribute('disabled')).toBe(
      true,
    );

    await user.click(screen.getByRole('combobox', { name: 'Copy into' }));
    await user.click(await screen.findByRole('option', { name: '2027-2028' }));
    expect(screen.getByRole('button', { name: 'Preview clone' }).hasAttribute('disabled')).toBe(
      false,
    );

    await user.click(screen.getByRole('button', { name: 'Preview clone' }));
    expect(onSubmit).toHaveBeenCalledWith({ sourceYearId: 'year-1', targetYearId: 'year-2' });
  });

  it('refuses to submit when source and target are the same year', async () => {
    const onSubmit = vi.fn();
    const { localeReady } = renderWithProviders(
      <CloneDialog
        open
        onOpenChange={vi.fn()}
        academicYears={YEARS}
        isPending={false}
        onSubmit={onSubmit}
      />,
      { locale: 'en', role: 'ADMIN', tenantId: 'tenant-1' },
    );
    await localeReady;

    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'Copy from' }));
    await user.click(await screen.findByRole('option', { name: '2026-2027' }));
    await user.click(screen.getByRole('combobox', { name: 'Copy into' }));
    await user.click(await screen.findByRole('option', { name: '2026-2027' }));

    expect(screen.getByRole('button', { name: 'Preview clone' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('renders the "include holidays" checkbox as permanently disabled and unchecked', async () => {
    const { localeReady } = renderWithProviders(
      <CloneDialog
        open
        onOpenChange={vi.fn()}
        academicYears={YEARS}
        isPending={false}
        onSubmit={vi.fn()}
      />,
      { locale: 'en', role: 'ADMIN', tenantId: 'tenant-1' },
    );
    await localeReady;

    const checkbox = await screen.findByRole('checkbox', { name: 'Include holidays' });
    expect(checkbox.hasAttribute('disabled')).toBe(true);
    expect(checkbox.getAttribute('aria-checked')).toBe('false');
  });

  it('resets the picked years when reopened', async () => {
    const onSubmit = vi.fn();
    const { rerender, localeReady } = renderWithProviders(
      <CloneDialog
        open
        onOpenChange={vi.fn()}
        academicYears={YEARS}
        isPending={false}
        onSubmit={onSubmit}
      />,
      { locale: 'en', role: 'ADMIN', tenantId: 'tenant-1' },
    );
    await localeReady;

    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'Copy from' }));
    await user.click(await screen.findByRole('option', { name: '2026-2027' }));

    rerender(
      <CloneDialog
        open={false}
        onOpenChange={vi.fn()}
        academicYears={YEARS}
        isPending={false}
        onSubmit={onSubmit}
      />,
    );
    rerender(
      <CloneDialog
        open
        onOpenChange={vi.fn()}
        academicYears={YEARS}
        isPending={false}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByRole('button', { name: 'Preview clone' }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('disables the submit button while a clone request is pending', async () => {
    const onSubmit = vi.fn();
    const { localeReady } = renderWithProviders(
      <CloneDialog
        open
        onOpenChange={vi.fn()}
        academicYears={YEARS}
        isPending
        onSubmit={onSubmit}
      />,
      { locale: 'en', role: 'ADMIN', tenantId: 'tenant-1' },
    );
    await localeReady;

    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'Copy from' }));
    await user.click(await screen.findByRole('option', { name: '2026-2027' }));
    await user.click(screen.getByRole('combobox', { name: 'Copy into' }));
    await user.click(await screen.findByRole('option', { name: '2027-2028' }));

    expect(screen.getByRole('button', { name: 'Preview clone' }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('calls onOpenChange(false) when cancel is clicked', async () => {
    const onOpenChange = vi.fn();
    const { localeReady } = renderWithProviders(
      <CloneDialog
        open
        onOpenChange={onOpenChange}
        academicYears={YEARS}
        isPending={false}
        onSubmit={vi.fn()}
      />,
      { locale: 'en', role: 'ADMIN', tenantId: 'tenant-1' },
    );
    await localeReady;

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
