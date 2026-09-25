import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PublishDialog } from './-publish-dialog';

afterEach(async () => {
  await cleanupTestState();
});

describe('PublishDialog', () => {
  it('states publication is one way, with no unpublish control anywhere in the dialog', async () => {
    const { localeReady } = renderWithProviders(
      <PublishDialog open onOpenChange={vi.fn()} routineId="routine-1" />,
      { tenantId: 'tenant-1', locale: 'en' },
    );
    await localeReady;

    await waitFor(() => expect(screen.getByText(/one-way/i)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /unpublish/i })).toBeNull();
  });

  it('publishes on confirm', async () => {
    let published = false;
    server.use(
      http.post('/api/v1/routines/routine-1/publish', () => {
        published = true;
        return HttpResponse.json({ id: 'routine-1', state: 'PUBLISHED' });
      }),
    );
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    const { localeReady } = renderWithProviders(
      <PublishDialog open onOpenChange={onOpenChange} routineId="routine-1" />,
      { tenantId: 'tenant-1', locale: 'en' },
    );
    await localeReady;

    await user.click(screen.getByRole('button', { name: /^publish$/i }));
    await waitFor(() => expect(published).toBe(true));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});
