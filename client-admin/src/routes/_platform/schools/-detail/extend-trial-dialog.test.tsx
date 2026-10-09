import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ExtendTrialDialog } from './extend-trial-dialog';

const SCHOOL_ID = 'school-1';
const URL = `/api/v1/schools/${SCHOOL_ID}/trial`;

function renderDialog(onOpenChange = vi.fn()) {
  return renderWithProviders(
    <ExtendTrialDialog
      open
      onOpenChange={onOpenChange}
      schoolId={SCHOOL_ID}
      schoolName="Ananta School"
    />,
    { locale: 'en', role: 'SUPER_ADMIN', tenantId: 'super-admin-own-tenant' },
  );
}

describe('ExtendTrialDialog', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('blocks submit with sentences when days and reason are invalid', async () => {
    let called = false;
    server.use(
      http.patch(URL, () => {
        called = true;
        return HttpResponse.json({});
      }),
    );
    const { user } = renderDialog();
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Days to add'), '400');
    await user.type(within(dialog).getByLabelText('Reason'), 'short');
    await user.click(within(dialog).getByRole('button', { name: 'Extend trial' }));

    expect(await within(dialog).findByText('Enter a whole number from 1 to 365.')).toBeTruthy();
    expect(within(dialog).getByText('Write at least 10 characters.')).toBeTruthy();
    expect(called).toBe(false);
  });

  it('a reason over 500 characters gets a translated sentence', async () => {
    const { user } = renderDialog();
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Days to add'), '7');
    await user.click(within(dialog).getByLabelText('Reason'));
    await user.paste('x'.repeat(501));
    await user.click(within(dialog).getByRole('button', { name: 'Extend trial' }));
    expect(await within(dialog).findByText('Keep the reason under 500 characters.')).toBeTruthy();
  });

  it('sends days, optional limit and reason, then closes', async () => {
    let body: unknown = null;
    server.use(
      http.patch(URL, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: SCHOOL_ID });
      }),
    );
    const onOpenChange = vi.fn();
    const { user } = renderDialog(onOpenChange);
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Days to add'), '30');
    await user.type(within(dialog).getByLabelText('Student limit (optional)'), '80');
    await user.type(within(dialog).getByLabelText('Reason'), 'Asked for more time');
    await user.click(within(dialog).getByRole('button', { name: 'Extend trial' }));

    await waitFor(() =>
      expect(body).toEqual({ days: 30, seat_limit: 80, reason: 'Asked for more time' }),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('omits the limit when left empty', async () => {
    let body: unknown = null;
    server.use(
      http.patch(URL, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: SCHOOL_ID });
      }),
    );
    const { user } = renderDialog();
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Days to add'), '7');
    await user.type(within(dialog).getByLabelText('Reason'), 'Asked for more time');
    await user.click(within(dialog).getByRole('button', { name: 'Extend trial' }));

    await waitFor(() => expect(body).toEqual({ days: 7, reason: 'Asked for more time' }));
  });

  it('shows a translated sentence for NOT_IN_TRIAL, not the server message', async () => {
    server.use(
      http.patch(URL, () =>
        HttpResponse.json(
          {
            statusCode: 409,
            message: 'This school never had a trial',
            details: { code: 'NOT_IN_TRIAL' },
            requestId: 'r',
            path: URL,
            timestamp: '2026-01-01T00:00:00.000Z',
          },
          { status: 409 },
        ),
      ),
    );
    const { user } = renderDialog();
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Days to add'), '7');
    await user.type(within(dialog).getByLabelText('Reason'), 'Asked for more time');
    await user.click(within(dialog).getByRole('button', { name: 'Extend trial' }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toBe('This school never had a trial.');
  });
});
