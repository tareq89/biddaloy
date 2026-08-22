import { UserRole } from '@biddaloy/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { cleanupTestState, renderWithProviders } from '../test/render-with-providers';

import { SchoolPicker } from './school-picker';

afterEach(async () => {
  await cleanupTestState();
});

const schools = [
  { tenantId: 'tenant-1', name: 'Greenview School', role: UserRole.ADMIN },
  { tenantId: 'tenant-2', name: 'Rose Valley School', role: UserRole.TEACHER },
];

describe('SchoolPicker', () => {
  it('renders every school as a labelled radio option, first one preselected', async () => {
    const { localeReady } = renderWithProviders(
      <SchoolPicker schools={schools} onSelect={vi.fn()} />,
      { locale: 'en' },
    );
    await localeReady;

    const first = await screen.findByRole('radio', { name: 'Greenview School, Admin' });
    const second = screen.getByRole('radio', { name: 'Rose Valley School, Teacher' });
    expect(first.getAttribute('aria-checked')).toBe('true');
    expect(second.getAttribute('aria-checked')).toBe('false');
  });

  // [8.9.11]: both memberships used to key and value on `tenantId` alone, so
  // React saw a duplicate key, the radio group couldn't tell the two apart,
  // and `handleSubmit`'s lookup always resolved to the first — the second
  // role at a school was literally unselectable.
  it('lets a user with two roles at one school select either of them', async () => {
    const dualRole = [
      { tenantId: 'tenant-1', name: 'Greenview School', role: UserRole.ADMIN },
      { tenantId: 'tenant-1', name: 'Greenview School', role: UserRole.PARENT },
    ];
    const onSelect = vi.fn();
    const user = userEvent.setup();
    const { localeReady } = renderWithProviders(
      <SchoolPicker schools={dualRole} onSelect={onSelect} />,
      { locale: 'en' },
    );
    await localeReady;

    const asAdmin = await screen.findByRole('radio', { name: 'Greenview School, Admin' });
    const asParent = screen.getByRole('radio', { name: 'Greenview School, Parent' });
    expect(asAdmin.getAttribute('aria-checked')).toBe('true');

    await user.click(asParent);
    await waitFor(() => expect(asParent.getAttribute('aria-checked')).toBe('true'));
    expect(asAdmin.getAttribute('aria-checked')).toBe('false');

    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(onSelect).toHaveBeenCalledWith('tenant-1', UserRole.PARENT);
  });

  it('has no accessibility violations', async () => {
    const { container, localeReady } = renderWithProviders(
      <SchoolPicker schools={schools} onSelect={vi.fn()} />,
      { locale: 'en' },
    );
    await localeReady;

    await expect(container).toHaveNoViolations();
  });

  it('arrow keys move roving focus, Space selects, and Continue submits the selected pair', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    const { localeReady } = renderWithProviders(
      <SchoolPicker schools={schools} onSelect={onSelect} />,
      { locale: 'en' },
    );
    await localeReady;

    screen.getByRole('radio', { name: 'Greenview School, Admin' }).focus();
    await user.keyboard('{ArrowDown}');
    await user.keyboard(' ');
    await waitFor(() =>
      expect(
        screen
          .getByRole('radio', { name: 'Rose Valley School, Teacher' })
          .getAttribute('aria-checked'),
      ).toBe('true'),
    );

    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(onSelect).toHaveBeenCalledWith('tenant-2', UserRole.TEACHER);
  });

  it('clicking anywhere on a card selects it, not just the small radio dot', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    const { localeReady } = renderWithProviders(
      <SchoolPicker schools={schools} onSelect={onSelect} />,
      { locale: 'en' },
    );
    await localeReady;

    await user.click(screen.getByText('Rose Valley School'));
    await waitFor(() =>
      expect(
        screen
          .getByRole('radio', { name: 'Rose Valley School, Teacher' })
          .getAttribute('aria-checked'),
      ).toBe('true'),
    );

    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(onSelect).toHaveBeenCalledWith('tenant-2', UserRole.TEACHER);
  });
});
