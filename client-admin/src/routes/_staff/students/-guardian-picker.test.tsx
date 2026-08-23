import { REGION_BD_EN } from '@biddaloy/ui/i18n';
import {
  cleanupTestState,
  guardianFactory,
  renderWithProviders,
  server,
  userEvent,
} from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import * as React from 'react';
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

  it('shows the mutation error when creating a guardian fails', async () => {
    // A 4xx, not 5xx — `shouldRetryQuery` retries 5xx responses (a couple
    // of times, with backoff), which would make this test wait out those
    // retries for no reason; a 4xx never retries.
    server.use(
      http.post(
        '/api/v1/guardians',
        () =>
          new HttpResponse(
            JSON.stringify({
              statusCode: 409,
              message: 'A guardian with this phone number already exists',
              timestamp: new Date().toISOString(),
              path: '/guardians',
              requestId: 'req-1',
            }),
            { status: 409, headers: { 'Content-Type': 'application/json' } },
          ),
      ),
    );
    renderWithProviders(
      <GuardianPicker selectedIds={[]} onSelectedIdsChange={vi.fn()} config={REGION_BD_EN} />,
      { tenantId: 'tenant-1', locale: 'en' },
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Add a new guardian' }));
    await user.type(screen.getByRole('textbox', { name: "Guardian's full name" }), 'Karim Rahman');
    await user.click(screen.getByRole('button', { name: 'Add guardian' }));

    expect(
      await screen.findByText('A guardian with this phone number already exists'),
    ).toBeTruthy();
  });

  it('appends the newly created guardian to whatever is selected when the response arrives, not a stale snapshot', async () => {
    const existing = guardianFactory({ id: 'existing-guardian', full_name: 'Existing Guardian' });
    server.use(
      http.get('/api/v1/guardians', () =>
        HttpResponse.json({ data: [existing], total: 1, page: 1, limit: 10, totalPages: 1 }),
      ),
      http.post('/api/v1/guardians', async () => {
        // Deliberately resolves after the test toggles another guardian
        // below — reproducing "selection changes while creation is
        // pending" without a real network delay.
        await new Promise((resolve) => setTimeout(resolve, 20));
        return HttpResponse.json(
          guardianFactory({ id: 'new-guardian', full_name: 'Salma Begum' }),
          {
            status: 201,
          },
        );
      }),
    );

    function ControlledGuardianPicker() {
      const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
      return (
        <GuardianPicker
          selectedIds={selectedIds}
          onSelectedIdsChange={setSelectedIds}
          config={REGION_BD_EN}
        />
      );
    }

    renderWithProviders(<ControlledGuardianPicker />, { tenantId: 'tenant-1', locale: 'en' });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Add a new guardian' }));
    await user.type(screen.getByRole('textbox', { name: "Guardian's full name" }), 'Salma Begum');
    await user.click(screen.getByRole('button', { name: 'Add guardian' }));

    // While that create is still in flight, select an already-existing
    // guardian via search — this is the "selection changes mid-mutation"
    // race the fix guards against.
    await user.type(screen.getByRole('textbox', { name: 'Search guardians' }), 'Existing');
    const checkbox = await screen.findByRole('checkbox', { name: /Existing Guardian/ });
    await user.click(checkbox);

    const selected = await screen.findByRole('list', { name: 'Linked guardians' });
    await waitFor(() => expect(within(selected).getByText(/Salma Begum/)).toBeTruthy());
    expect(within(selected).getByText(/Existing Guardian/)).toBeTruthy();
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
