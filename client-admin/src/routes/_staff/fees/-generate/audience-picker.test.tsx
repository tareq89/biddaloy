import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AudiencePicker } from './audience-picker';

function renderPicker() {
  const onSelectedChange = vi.fn();
  const view = renderWithProviders(
    <AudiencePicker
      academicYearId="year-1"
      selected={new Map()}
      onSelectedChange={onSelectedChange}
    />,
    { tenantId: 'tenant-1', locale: 'en' },
  );
  return { ...view, onSelectedChange };
}

describe('AudiencePicker', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('adds every matching id to the selection on "Select all N matching"', async () => {
    server.use(
      http.get('/api/v1/students/ids', () =>
        HttpResponse.json({
          ids: Array.from({ length: 120 }, (_, i) => `student-${i}`),
          total: 120,
        }),
      ),
    );

    const user = userEvent.setup();
    const { onSelectedChange } = renderPicker();

    await user.click(await screen.findByRole('button', { name: /Select all/ }));

    await waitFor(() => expect(onSelectedChange).toHaveBeenCalled());
    const lastCallArg = onSelectedChange.mock.calls.at(-1)?.[0] as Map<string, string>;
    expect(lastCallArg.size).toBe(120);
  });

  it('does not submit the surrounding form when Enter is pressed in the search box', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    renderWithProviders(
      <form onSubmit={onSubmit}>
        <AudiencePicker academicYearId="year-1" selected={new Map()} onSelectedChange={vi.fn()} />
      </form>,
      { tenantId: 'tenant-1', locale: 'en' },
    );

    await user.type(await screen.findByLabelText('Search students'), 'Rahim{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
