/** [67.5.05] The "Who gets it" picker: group toggles, chips, chip removal. */
import type { ManualAudience } from '@biddaloy/ui/hooks';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
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
});
