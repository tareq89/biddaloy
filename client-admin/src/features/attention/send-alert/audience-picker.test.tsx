/** [67.5.05] The "Who gets it" picker: group toggles, chips, chip removal. */
import type { ManualAudience } from '@biddaloy/ui/hooks';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { AudiencePicker } from './audience-picker';

function Harness({ onValue }: { onValue: (v: ManualAudience) => void }) {
  const [value, setValue] = React.useState<ManualAudience>({});
  return (
    <AudiencePicker
      value={value}
      onChange={(next) => {
        setValue(next);
        onValue(next);
      }}
    />
  );
}

/** Searches the mocked server has started answering (each waits 300 ms). */
let searchRequests = 0;

function renderPicker(onValue: (v: ManualAudience) => void) {
  server.use(
    http.get('/api/v1/classes', () =>
      HttpResponse.json({
        data: [{ id: 'c1', name: 'Class 7' }],
        total: 1,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
    http.get('/api/v1/users', async ({ request }) => {
      const search = new URL(request.url).searchParams.get('search');
      if (search) {
        searchRequests += 1;
        await delay(300);
      }
      const row = (id: string, name: string) => ({
        id,
        full_name: name,
        email: `${id}@x.test`,
        role: 'TEACHER',
        status: 'ACTIVE',
      });
      const data = search
        ? [row('u-zahid', 'Zahid Hasan')]
        : Array.from({ length: 100 }, (_, i) => row(`u${i}`, `Person ${i}`));
      return HttpResponse.json({ data, total: data.length, page: 1, limit: 100, totalPages: 1 });
    }),
    http.get('/api/v1/classes/c1/sections', () =>
      HttpResponse.json([{ id: 's1', class_id: 'c1', section_name: 'A', enrolled_count: 3 }]),
    ),
  );
  const root = createRootRoute();
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <Harness onValue={onValue} />,
  });
  renderWithRouter(root.addChildren([index]), {
    initialEntries: ['/'],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
}

describe('AudiencePicker', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows the add box when a group is checked, adds a chip, removes it, and unchecking clears', async () => {
    const user = userEvent.setup();
    let latest: ManualAudience = {};
    renderPicker((v) => (latest = v));

    expect(screen.queryByRole('combobox', { name: 'Add a role' })).toBeNull();
    await user.click(await screen.findByRole('checkbox', { name: 'By role' }));
    await user.click(await screen.findByRole('combobox', { name: 'Add a role' }));
    await user.click(await screen.findByRole('option', { name: 'Teacher' }));
    expect(latest).toEqual({ roles: ['TEACHER'] });

    await user.click(screen.getByRole('button', { name: 'Remove Teacher' }));
    expect(latest).toEqual({});

    await user.click(await screen.findByRole('combobox', { name: 'Add a role' }));
    await user.click(await screen.findByRole('option', { name: 'Parent' }));
    await user.click(screen.getByRole('checkbox', { name: 'By role' }));
    expect(latest).toEqual({});
    expect(screen.queryByRole('combobox', { name: 'Add a role' })).toBeNull();
  });

  it('offers "Class – Section" options for the students group', async () => {
    const user = userEvent.setup();
    let latest: ManualAudience = {};
    renderPicker((v) => (latest = v));

    await user.click(await screen.findByRole('checkbox', { name: 'Students of sections' }));
    await user.click(await screen.findByRole('combobox', { name: 'Add a section' }));
    await user.click(await screen.findByRole('option', { name: 'Class 7 – A' }));
    await waitFor(() => expect(latest).toEqual({ sectionIds: ['s1'] }));
  });

  it('finds a person beyond the first 100 by server search and keeps their chip label', async () => {
    const user = userEvent.setup();
    let latest: ManualAudience = {};
    renderPicker((v) => (latest = v));

    await user.click(await screen.findByRole('checkbox', { name: 'Named people' }));
    const box = await screen.findByRole('combobox', { name: 'Search by name or phone' });
    await user.click(box);
    await user.type(box, 'Zahid');
    await user.click(await screen.findByRole('option', { name: /Zahid Hasan/ }, { timeout: 3000 }));
    await waitFor(() => expect(latest).toEqual({ userIds: ['u-zahid'] }));

    await user.click(screen.getByRole('combobox', { name: 'Search by name or phone' }));
    await user.type(screen.getByRole('combobox', { name: 'Search by name or phone' }), 'Nobody');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Remove Zahid Hasan/ })).toBeTruthy(),
    );
  });

  it('lists nobody while the typed search is pending, so a quick Enter picks no one from the old list', async () => {
    const user = userEvent.setup();
    let latest: ManualAudience = {};
    searchRequests = 0;
    renderPicker((v) => (latest = v));

    await user.click(await screen.findByRole('checkbox', { name: 'Named people' }));
    const box = await screen.findByRole('combobox', { name: 'Search by name or phone' });
    await user.click(box);
    await screen.findByRole('option', { name: /Person 0/ });
    // Enter lands inside the 300 ms debounce: the unfiltered list must be gone.
    await user.type(box, 'Zahid{Enter}');
    expect(latest).toEqual({});
    expect(screen.queryByRole('option', { name: /Person 0/ })).toBeNull();
    expect(screen.getByText('Loading…')).toBeTruthy();
    // ...and stays gone while the search request itself is in flight.
    await waitFor(() => expect(searchRequests).toBeGreaterThan(0));
    expect(screen.queryByRole('option', { name: /Person 0/ })).toBeNull();

    await screen.findByRole('option', { name: /Zahid Hasan/ }, { timeout: 3000 });
    await user.keyboard('{Enter}');
    await waitFor(() => expect(latest).toEqual({ userIds: ['u-zahid'] }));
  });
});
