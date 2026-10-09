import '@biddaloy/ui/test';

import { toast } from '@biddaloy/ui/components';
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
      expect(inputValue(screen.getByLabelText('Gap between periods (minutes)'))).toBe('10');
    });
    expect(inputValue(screen.getByLabelText('Most periods a teacher takes in a day'))).toBe('6');
    expect(screen.getByRole('heading', { name: 'Routine rules' })).toBeTruthy();
    expect(
      screen.getByText('A new period starts this many minutes after the one before it.'),
    ).toBeTruthy();
    expect(screen.getAllByText('Leave empty for no limit.')).toHaveLength(2);
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

    const input = await screen.findByLabelText('Gap between periods (minutes)');
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

    const input = await screen.findByLabelText('Most periods a teacher takes in a day');
    await user.clear(input);
    await user.type(input, '0');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(
        screen.getAllByText('Enter a whole number of at least 1, or leave it empty for no limit.')
          .length,
      ).toBeGreaterThan(0),
    );
    expect(patchBody).not.toHaveBeenCalled();
  });

  it('shows a translated toast, not the server text, when saving fails', async () => {
    server.use(
      http.get('/api/v1/schools/:id/settings', () =>
        HttpResponse.json({
          version: 1,
          region: { locale: 'en', numerals: 'LATIN', timezone: 'Asia/Dhaka' },
          routine: { defaultChangeoverMinutes: 5 },
        }),
      ),
      http.patch('/api/v1/schools/:id/settings', () =>
        HttpResponse.json({ statusCode: 400, message: 'routine.bad thing' }, { status: 400 }),
      ),
    );
    const errorSpy = vi.spyOn(toast, 'error').mockImplementation(() => '');
    try {
      const { user } = renderWithProviders(<RoutineSettingsPanel schoolId={SCHOOL_ID} />, {
        locale: 'en',
        role: 'ADMIN',
        tenantId: SCHOOL_ID,
      });

      const input = await screen.findByLabelText('Gap between periods (minutes)');
      await user.clear(input);
      await user.type(input, '12');
      await user.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() =>
        expect(errorSpy).toHaveBeenCalledWith(
          "Couldn't save the rules. Check the numbers and try again.",
        ),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('shows the cap validation message in Bangla on a Bangla screen', async () => {
    server.use(
      http.get('/api/v1/schools/:id/settings', () =>
        HttpResponse.json({
          version: 1,
          region: { locale: 'bn', numerals: 'BENGALI', timezone: 'Asia/Dhaka' },
          routine: { defaultChangeoverMinutes: 5 },
        }),
      ),
    );
    const { user } = renderWithProviders(<RoutineSettingsPanel schoolId={SCHOOL_ID} />, {
      locale: 'bn',
      role: 'ADMIN',
      tenantId: SCHOOL_ID,
    });

    const input = await screen.findByLabelText('একজন শিক্ষক দিনে সর্বোচ্চ কয়টি পিরিয়ড নেবেন');
    await user.clear(input);
    await user.type(input, '0');
    await user.click(screen.getByRole('button', { name: 'সংরক্ষণ করুন' }));

    await waitFor(() =>
      expect(
        screen.getAllByText('১ বা তার বেশি একটি পূর্ণ সংখ্যা দিন, অথবা সীমা না চাইলে খালি রাখুন।')
          .length,
      ).toBeGreaterThan(0),
    );
  });
});
