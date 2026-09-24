import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RoutineSettingsPanel } from './routine-settings-panel';

const SCHOOL_ID = 'school-1';

function inputValue(element: HTMLElement): string {
  return (element as HTMLInputElement).value;
}

describe('RoutineSettingsPanel', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders the current values', async () => {
    server.use(
      http.get('/api/v1/schools/:id/settings', () =>
        HttpResponse.json({
          version: 1,
          region: { locale: 'en', numerals: 'LATIN', timezone: 'Asia/Dhaka' },
          routine: {
            defaultChangeoverMinutes: 10,
            maxPeriodsPerTeacherPerDay: 6,
            maxConsecutivePeriods: 4,
          },
        }),
      ),
    );

    renderWithProviders(<RoutineSettingsPanel schoolId={SCHOOL_ID} />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: SCHOOL_ID,
    });

    await waitFor(() => {
      expect(inputValue(screen.getByLabelText('Changeover gap (minutes)'))).toBe('10');
    });
    expect(inputValue(screen.getByLabelText('Max periods per teacher per day'))).toBe('6');
  });

  it('sends only the routine slice in the saved payload', async () => {
    server.use(
      http.get('/api/v1/schools/:id/settings', () =>
        HttpResponse.json({
          version: 1,
          region: { locale: 'en', numerals: 'LATIN', timezone: 'Asia/Dhaka' },
          routine: { defaultChangeoverMinutes: 5 },
        }),
      ),
    );
    const patchBody = vi.fn();
    server.use(
      http.patch('/api/v1/schools/:id/settings', async ({ request }) => {
        patchBody(await request.json());
        return HttpResponse.json({ version: 1 });
      }),
    );

    const { user } = renderWithProviders(<RoutineSettingsPanel schoolId={SCHOOL_ID} />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: SCHOOL_ID,
    });

    const input = await screen.findByLabelText('Changeover gap (minutes)');
    await user.clear(input);
    await user.type(input, '15');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patchBody).toHaveBeenCalled());
    const body = patchBody.mock.calls[0]![0];
    expect(Object.keys(body)).toEqual(['version', 'routine']);
    expect(body.routine.defaultChangeoverMinutes).toBe(15);
  });

  it('rejects a cap of 0 inline instead of sending it to the server', async () => {
    server.use(
      http.get('/api/v1/schools/:id/settings', () =>
        HttpResponse.json({
          version: 1,
          region: { locale: 'en', numerals: 'LATIN', timezone: 'Asia/Dhaka' },
          routine: { defaultChangeoverMinutes: 5 },
        }),
      ),
    );
    const patchBody = vi.fn();
    server.use(
      http.patch('/api/v1/schools/:id/settings', async ({ request }) => {
        patchBody(await request.json());
        return HttpResponse.json({ version: 1 });
      }),
    );

    const { user } = renderWithProviders(<RoutineSettingsPanel schoolId={SCHOOL_ID} />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: SCHOOL_ID,
    });

    const input = await screen.findByLabelText('Max periods per teacher per day');
    await user.clear(input);
    await user.type(input, '0');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(
        screen.getAllByText('Must be a whole number of at least 1, or empty for no cap').length,
      ).toBeGreaterThan(0),
    );
    expect(patchBody).not.toHaveBeenCalled();
  });
});
