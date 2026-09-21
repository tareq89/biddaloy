import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OrganisationSection } from './OrganisationSection';

const SCHOOL_ID = 'school-1';

const ORGANISATION = {
  shifts: ['Morning', 'Day'],
  versions: ['Bangla'],
  groups: [],
};

describe('OrganisationSection', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders the three list editors with their current values', async () => {
    renderWithProviders(<OrganisationSection schoolId={SCHOOL_ID} organisation={ORGANISATION} />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: SCHOOL_ID,
    });

    const shifts = within(await screen.findByTestId('organisation-shifts'));
    expect(shifts.getByText('Morning')).toBeDefined();
    expect(shifts.getByText('Day')).toBeDefined();

    const versions = within(screen.getByTestId('organisation-versions'));
    expect(versions.getByText('Bangla')).toBeDefined();

    const groups = within(screen.getByTestId('organisation-groups'));
    expect(groups.getByText('No values yet.')).toBeDefined();
  });

  it('adding a value saves it in the organisation patch', async () => {
    const patchBody = vi.fn();
    server.use(
      http.patch('/api/v1/schools/:id/settings', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        patchBody(body);
        return HttpResponse.json({
          version: 1,
          organisation: { ...ORGANISATION, groups: ['Science'] },
        });
      }),
    );

    const { user } = renderWithProviders(
      <OrganisationSection schoolId={SCHOOL_ID} organisation={ORGANISATION} />,
      { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID },
    );

    const groups = within(await screen.findByTestId('organisation-groups'));
    await user.type(groups.getByPlaceholderText('Add a value'), 'Science');
    await user.click(groups.getByRole('button', { name: 'Add' }));

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patchBody).toHaveBeenCalled());
    expect(patchBody.mock.calls[0]![0].organisation.groups).toEqual(['Science']);
  });

  it('surfaces a server refusal to remove a value inline on that row', async () => {
    server.use(
      http.patch('/api/v1/schools/:id/settings', () =>
        HttpResponse.json(
          {
            statusCode: 400,
            message:
              'Cannot remove "Day" from shifts — 2 row(s) still use it. Rename it instead, or reassign those rows first.',
            timestamp: new Date().toISOString(),
            path: '/api/v1/schools/school-1/settings',
            requestId: 'req-1',
          },
          { status: 400 },
        ),
      ),
    );

    const { user } = renderWithProviders(
      <OrganisationSection schoolId={SCHOOL_ID} organisation={ORGANISATION} />,
      { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID },
    );

    const shifts = within(await screen.findByTestId('organisation-shifts'));
    const dayRow = shifts.getByText('Day').closest('li')!;
    await user.click(within(dayRow).getByRole('button', { name: 'Remove' }));

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(within(dayRow).getByText(/2 row\(s\) still use it/)).toBeDefined());
  });

  it('a rename sends an explicit { list, from, to } instruction', async () => {
    const patchBody = vi.fn();
    server.use(
      http.patch('/api/v1/schools/:id/settings', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        patchBody(body);
        return HttpResponse.json({
          version: 1,
          organisation: { ...ORGANISATION, shifts: ['Prabhati', 'Day'] },
        });
      }),
    );

    const { user } = renderWithProviders(
      <OrganisationSection schoolId={SCHOOL_ID} organisation={ORGANISATION} />,
      { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID },
    );

    const shifts = within(await screen.findByTestId('organisation-shifts'));
    const morningRow = shifts.getByText('Morning').closest('li')!;
    await user.click(within(morningRow).getByRole('button', { name: 'Rename' }));

    const renameInput = within(morningRow).getByPlaceholderText('New name');
    await user.clear(renameInput);
    await user.type(renameInput, 'Prabhati');
    await user.click(within(morningRow).getByRole('button', { name: 'Save' }));

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patchBody).toHaveBeenCalled());
    const body = patchBody.mock.calls[0]![0];
    expect(body.organisation.shifts).toEqual(['Prabhati', 'Day']);
    expect(body.organisationRenames).toEqual([{ list: 'shifts', from: 'Morning', to: 'Prabhati' }]);
  });

  // [CodeRabbit, PR #916] Only one rename per list per save — a second
  // rename on a *different* entry must not silently overwrite the first.
  it('refuses a second rename on a different entry in the same list', async () => {
    const { user } = renderWithProviders(
      <OrganisationSection schoolId={SCHOOL_ID} organisation={ORGANISATION} />,
      { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID },
    );

    const shifts = within(await screen.findByTestId('organisation-shifts'));
    const morningRow = shifts.getByText('Morning').closest('li')!;
    await user.click(within(morningRow).getByRole('button', { name: 'Rename' }));
    const renameInput = within(morningRow).getByPlaceholderText('New name');
    await user.type(renameInput, 'Prabhati');
    await user.click(within(morningRow).getByRole('button', { name: 'Save' }));

    // Morning's row now reads "Prabhati" — the Rename button on the
    // *other* row (Day) must be disabled while that rename is pending.
    // No jest-dom in this repo's test setup (same gotcha
    // `AttendanceSection.test.tsx`'s own comment documents) — a plain
    // `.disabled` read instead of `toBeDisabled()`.
    const dayRow = shifts.getByText('Day').closest('li')!;
    const dayRenameButton = within(dayRow).getByRole('button', { name: 'Rename' });
    expect((dayRenameButton as HTMLButtonElement).disabled).toBe(true);
  });

  it('a chained rename on the same entry sends a single { from: original, to: latest }', async () => {
    const patchBody = vi.fn();
    server.use(
      http.patch('/api/v1/schools/:id/settings', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        patchBody(body);
        return HttpResponse.json({
          version: 1,
          organisation: { ...ORGANISATION, shifts: ['Shokal', 'Day'] },
        });
      }),
    );

    const { user } = renderWithProviders(
      <OrganisationSection schoolId={SCHOOL_ID} organisation={ORGANISATION} />,
      { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID },
    );

    const shifts = within(await screen.findByTestId('organisation-shifts'));
    let row = shifts.getByText('Morning').closest('li')!;
    await user.click(within(row).getByRole('button', { name: 'Rename' }));
    let renameInput = within(row).getByPlaceholderText('New name');
    await user.clear(renameInput);
    await user.type(renameInput, 'Prabhati');
    await user.click(within(row).getByRole('button', { name: 'Save' }));

    // Re-rename the same entry, now reading "Prabhati".
    row = shifts.getByText('Prabhati').closest('li')!;
    await user.click(within(row).getByRole('button', { name: 'Rename' }));
    renameInput = within(row).getByPlaceholderText('New name');
    await user.clear(renameInput);
    await user.type(renameInput, 'Shokal');
    await user.click(within(row).getByRole('button', { name: 'Save' }));

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patchBody).toHaveBeenCalled());
    const body = patchBody.mock.calls[0]![0];
    expect(body.organisation.shifts).toEqual(['Shokal', 'Day']);
    expect(body.organisationRenames).toEqual([{ list: 'shifts', from: 'Morning', to: 'Shokal' }]);
  });
});
