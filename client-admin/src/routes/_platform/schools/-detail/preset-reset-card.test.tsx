import '@biddaloy/ui/test';

import { toast } from '@biddaloy/ui/components';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ResetPresetCard } from './preset-reset-card';

const ID = '00000000-0000-4000-8000-000000000001';
const URL = `/api/v1/platform/schools/${ID}/preset/reset`;

async function openDialog() {
  renderWithProviders(<ResetPresetCard schoolId={ID} schoolName="Ananta" />, {
    locale: 'en',
    role: 'SUPER_ADMIN',
    tenantId: 'super-admin-own-tenant',
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Undo ready-made curriculum' }));
}

async function fill(text: string) {
  fireEvent.change(await screen.findByLabelText(/Reason/), { target: { value: text } });
}
const submit = () => screen.getByRole('button', { name: 'Undo it' });

describe('ResetPresetCard', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTestState();
  });

  it('disables submit below 10 characters, enables at 10', async () => {
    await openDialog();
    await fill('too short');
    await waitFor(() => expect((submit() as HTMLButtonElement).disabled).toBe(true));
    await fill('long enough');
    await waitFor(() => expect((submit() as HTMLButtonElement).disabled).toBe(false));
  });

  it('closes and toasts on success', async () => {
    const spy = vi.spyOn(toast, 'success').mockReturnValue('id');
    server.use(http.post(URL, () => HttpResponse.json({ deleted: { classes: 3, subjects: 2 } })));
    await openDialog();
    await fill('wrong preset applied');
    fireEvent.click(submit());
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('Ready-made curriculum undone. 5 records removed.'),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('lists blockers on PRESET_RESET_BLOCKED', async () => {
    server.use(
      http.post(URL, () =>
        HttpResponse.json(
          {
            statusCode: 409,
            requestId: 'r-1',
            path: '/',
            timestamp: 't',
            message: 'blocked',
            details: {
              code: 'PRESET_RESET_BLOCKED',
              blockers: [{ entity: 'fee structures', count: 4 }],
            },
          },
          { status: 409 },
        ),
      ),
    );
    await openDialog();
    await fill('wrong preset applied');
    fireEvent.click(submit());
    expect(await screen.findByText('Fee structures')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('shows the not-applied message', async () => {
    server.use(
      http.post(URL, () =>
        HttpResponse.json(
          {
            statusCode: 409,
            requestId: 'r-1',
            path: '/',
            timestamp: 't',
            message: 'x',
            details: { code: 'PRESET_NOT_APPLIED' },
          },
          { status: 409 },
        ),
      ),
    );
    await openDialog();
    await fill('wrong preset applied');
    fireEvent.click(submit());
    expect(
      await screen.findByText('This school has no ready-made curriculum to undo'),
    ).toBeTruthy();
  });
});
