import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ExtendTrialDialog } from './extend-trial-dialog';

const view = (onOpenChange = vi.fn()) =>
  renderWithProviders(
    <ExtendTrialDialog open onOpenChange={onOpenChange} schoolId="s-1" schoolName="Rose Valley" />,
    { locale: 'en', role: 'SUPER_ADMIN', tenantId: 'platform' },
  );

async function fill(user: ReturnType<typeof userEvent.setup>, seats = '50', months = '3') {
  await user.type(await screen.findByLabelText('Number of seats'), seats);
  await user.type(screen.getByLabelText('For how many months'), months);
  await user.type(screen.getByLabelText('Reason'), 'Asked for a longer trial');
}

afterEach(async () => {
  await cleanupTestState();
});

describe('ExtendTrialDialog', () => {
  it('sends seats, months, reason and one idempotency key, then closes', async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post('*/platform/billing/schools/:id/grant', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({});
      }),
    );
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    const { container } = view(onOpenChange);
    await fill(user);
    await expect(container).toHaveNoViolations();
    await user.click(screen.getByRole('button', { name: 'Extend trial' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(body).toMatchObject({ seats: 50, months: 3, reason: 'Asked for a longer trial' });
    expect(typeof body.idempotency_key).toBe('string');
  });

  it('refuses out-of-range months before any request', async () => {
    let hit = false;
    server.use(
      http.post(
        '*/platform/billing/schools/:id/grant',
        () => ((hit = true), HttpResponse.json({})),
      ),
    );
    const user = userEvent.setup();
    view();
    await fill(user, '50', '30');
    await user.click(screen.getByRole('button', { name: 'Extend trial' }));
    expect(await screen.findByText('Enter a whole number from 1 to 24.')).toBeTruthy();
    expect(hit).toBe(false);
  });

  it('a server error shows a fixed sentence and never echoes the input', async () => {
    server.use(
      http.post('*/platform/billing/schools/:id/grant', () =>
        HttpResponse.json(
          {
            statusCode: 400,
            message: 'secret server text',
            timestamp: '',
            path: '/',
            requestId: 'r',
          },
          { status: 400 },
        ),
      ),
    );
    const user = userEvent.setup();
    view();
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Extend trial' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Could not extend the trial. Try again.');
  });
});
