import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RevokeDialog } from './revoke-dialog';

describe('RevokeDialog', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('cannot be cancelled or dismissed while the revoke request is in flight', async () => {
    server.use(
      http.post('/api/v1/print-history/items/i-1/revoke', async () => {
        await delay(300);
        return HttpResponse.json({ item_id: 'i-1', revoked_at: '2027-03-02T00:00:00.000Z' });
      }),
    );
    const onOpenChange = vi.fn();
    const { user } = renderWithProviders(
      <RevokeDialog open onOpenChange={onOpenChange} itemId="i-1" subjectLabel="Rahim" />,
      { locale: 'en', role: 'ADMIN', tenantId: 'school-1' },
    );

    await user.type(await screen.findByLabelText('Reason'), 'Lost card');
    await user.click(screen.getByRole('button', { name: 'Revoke' }));

    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Cancel' }).disabled).toBe(true),
    );
    await user.keyboard('{Escape}');
    expect(onOpenChange).not.toHaveBeenCalled();

    // Once the request finishes the dialog closes normally.
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('reads correctly for any document: no "card" in the text, confirm is "Revoke"', async () => {
    renderWithProviders(
      <RevokeDialog open onOpenChange={vi.fn()} itemId="i-1" subjectLabel="Rahim" />,
      { locale: 'en', role: 'ADMIN', tenantId: 'school-1' },
    );

    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).not.toMatch(/card/i);
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeTruthy();
  });
});
