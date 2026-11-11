import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SetCurrentDialog } from './-set-current-dialog';

afterEach(async () => {
  await cleanupTestState();
});

function serveReadiness(teacher_assignments: number) {
  server.use(
    http.get('/api/v1/academic-years/:id/readiness', () =>
      HttpResponse.json({ classes: 6, teacher_assignments, committed_promotion_runs: 1 }),
    ),
  );
}

async function open(onConfirmed = vi.fn()) {
  const { localeReady } = renderWithProviders(
    <SetCurrentDialog
      open
      onOpenChange={vi.fn()}
      academicYearId="year-2"
      academicYearName="2027"
      onConfirmed={onConfirmed}
    />,
    { tenantId: 'tenant-1', locale: 'en' },
  );
  await localeReady;
  return onConfirmed;
}

describe('SetCurrentDialog readiness [69.4.04]', () => {
  it('shows the counts and warns at 0 teacher assignments, and Set as current stays on', async () => {
    serveReadiness(0);
    await open();
    expect(
      await screen.findByText('Classes: 6 · Teacher assignments: 0 · Promotions committed: 1'),
    ).toBeTruthy();
    expect(screen.getByText(/Teachers will see no students/)).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Set as current' }).disabled).toBe(
      false,
    );
  });

  it('shows no warning when teachers are assigned', async () => {
    serveReadiness(30);
    await open();
    await screen.findByText(/Teacher assignments: 30/);
    expect(screen.queryByText(/Teachers will see no students/)).toBeNull();
  });

  it('confirming sets the year current', async () => {
    serveReadiness(30);
    server.use(
      http.post('/api/v1/academic-years/:id/set-current', () =>
        HttpResponse.json({ id: 'year-2' }),
      ),
    );
    const onConfirmed = await open();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Set as current' }));
    await waitFor(() => expect(onConfirmed).toHaveBeenCalled());
  });
});
