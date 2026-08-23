import { REGION_BD_EN } from '@biddaloy/ui/i18n';
import {
  cleanupTestState,
  guardianFactory,
  renderWithProviders,
  server,
  userEvent,
} from '@biddaloy/ui/test';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GuardianPicker } from './-guardian-picker';

describe('GuardianPicker', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows already-linked guardians from initialGuardians before any search runs', async () => {
    const guardian = guardianFactory({ id: 'guardian-1', full_name: 'Karim Rahman' });
    const { localeReady } = renderWithProviders(
      <GuardianPicker
        selectedIds={['guardian-1']}
        onSelectedIdsChange={vi.fn()}
        initialGuardians={[guardian]}
        config={REGION_BD_EN}
      />,
      { tenantId: 'tenant-1', locale: 'en' },
    );
    await localeReady;

    const selected = await screen.findByRole('list', { name: 'Linked guardians' });
    expect(within(selected).getByText(/Karim Rahman/)).toBeTruthy();
  });

  it('removing a linked guardian calls onSelectedIdsChange without it', async () => {
    const guardian = guardianFactory({ id: 'guardian-1', full_name: 'Karim Rahman' });
    const onSelectedIdsChange = vi.fn();
    const { localeReady } = renderWithProviders(
      <GuardianPicker
        selectedIds={['guardian-1']}
        onSelectedIdsChange={onSelectedIdsChange}
        initialGuardians={[guardian]}
        config={REGION_BD_EN}
      />,
      { tenantId: 'tenant-1', locale: 'en' },
    );
    await localeReady;

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Remove Karim Rahman' }));

    expect(onSelectedIdsChange).toHaveBeenCalledWith([]);
  });

  it('shows a no-results message when a search matches nothing', async () => {
    server.use(
      http.get('/api/v1/guardians', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 }),
      ),
    );
    const { localeReady } = renderWithProviders(
      <GuardianPicker selectedIds={[]} onSelectedIdsChange={vi.fn()} config={REGION_BD_EN} />,
      { tenantId: 'tenant-1', locale: 'en' },
    );
    await localeReady;

    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Search guardians' }), 'Nobody');

    expect(await screen.findByText('No guardians found.')).toBeTruthy();
  });

  it('requires a name before creating a new guardian inline', async () => {
    const { localeReady } = renderWithProviders(
      <GuardianPicker selectedIds={[]} onSelectedIdsChange={vi.fn()} config={REGION_BD_EN} />,
      { tenantId: 'tenant-1', locale: 'en' },
    );
    await localeReady;

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Add a new guardian' }));
    await user.click(screen.getByRole('button', { name: 'Add guardian' }));

    expect(await screen.findByText('Guardian name is required.')).toBeTruthy();
  });

  it('is axe clean', async () => {
    const guardian = guardianFactory({ id: 'guardian-1', full_name: 'Karim Rahman' });
    const { container, localeReady } = renderWithProviders(
      <GuardianPicker
        selectedIds={['guardian-1']}
        onSelectedIdsChange={vi.fn()}
        initialGuardians={[guardian]}
        config={REGION_BD_EN}
      />,
      { tenantId: 'tenant-1', locale: 'en' },
    );
    await localeReady;
    await screen.findByRole('list', { name: 'Linked guardians' });

    await expect(container).toHaveNoViolations();
  });
});
