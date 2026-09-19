import '@biddaloy/ui/test';

import type { MaskedRegionSettings } from '@biddaloy/ui/hooks';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CalendarSection } from './CalendarSection';

const SCHOOL_ID = 'school-1';

const REGION: MaskedRegionSettings = {
  locale: 'en-BD',
  country: 'BD',
  currency: { code: 'BDT', symbol: '৳', position: 'prefix', decimals: 2, grouping: 'lakh-crore' },
  numerals: 'latin',
  date: { format: 'dd/MM/yyyy', firstDayOfWeek: 0, calendar: 'gregorian' },
  phone: { country: 'BD', pattern: '^01[0-9]{9}$', example: '01712345678', displayFormat: '+880 XXXXXXXXXX' },
  address: { fields: ['street', 'city'], order: ['street', 'city'] },
  academicYear: { startMonth: 1 },
  identifiers: { national: 'NID', student: 'Student ID' },
  timezone: 'Asia/Dhaka',
  calendar: { termLabel: 'TERM' },
};

function mockCalendarSettings() {
  server.use(
    http.get('/api/v1/calendar-settings', () =>
      HttpResponse.json({
        termLabel: 'TERM',
        country: 'BD',
        firstDayOfWeek: 5,
        weeklyOffDays: [5],
        timezone: 'Asia/Dhaka',
        currentAcademicYear: null,
      }),
    ),
  );
}

describe('CalendarSection', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('sends country and calendar.termLabel in the saved payload, unchanged region fields passed through', async () => {
    mockCalendarSettings();
    const patchBody = vi.fn();
    server.use(
      http.patch('/api/v1/schools/:id/settings', async ({ request }) => {
        patchBody(await request.json());
        return HttpResponse.json({ version: 1, region: REGION });
      }),
    );

    const { user } = renderWithProviders(
      <CalendarSection schoolId={SCHOOL_ID} region={REGION} />,
      { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID },
    );

    await user.selectOptions(await screen.findByLabelText('Country'), 'IN');
    await user.selectOptions(screen.getByLabelText('What do you call a grading period?'), 'SEMESTER');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patchBody).toHaveBeenCalled());
    const region = patchBody.mock.calls[0]![0].region;
    expect(region.country).toBe('IN');
    expect(region.calendar).toEqual({ termLabel: 'SEMESTER' });
    // Fields this section doesn't own pass through unchanged.
    expect(region.locale).toBe('en-BD');
    expect(region.currency).toEqual(REGION.currency);
  });

  it('shows the derived week start / weekend days from GET /calendar-settings', async () => {
    mockCalendarSettings();

    renderWithProviders(<CalendarSection schoolId={SCHOOL_ID} region={REGION} />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: SCHOOL_ID,
    });

    expect(
      await screen.findByText('Week starts Friday, weekend is Friday, timezone Asia/Dhaka'),
    ).toBeTruthy();
  });
});
