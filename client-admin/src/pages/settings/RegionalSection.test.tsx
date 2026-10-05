import '@biddaloy/ui/test';

import type { MaskedRegionSettings } from '@biddaloy/ui/hooks';
import { REGION_BD_EN, RegionConfigProvider } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RegionalSection } from './RegionalSection';

const SERVER_TEXT = 'SERVER_SECRET_TEXT';
const failing = (path: string, method: 'patch' | 'put' | 'post' = 'patch') =>
  http[method](path, () =>
    HttpResponse.json(
      {
        statusCode: 400,
        message: SERVER_TEXT,
        timestamp: new Date().toISOString(),
        path,
        requestId: 'r',
      },
      { status: 400 },
    ),
  );

const SCHOOL_ID = 'school-1';

const REGION: MaskedRegionSettings = {
  locale: 'bn-BD',
  country: 'BD',
  currency: { code: 'BDT', symbol: '৳', position: 'prefix', decimals: 2, grouping: 'lakh-crore' },
  numerals: 'latin',
  date: { format: 'dd/MM/yyyy', firstDayOfWeek: 0, calendar: 'gregorian' },
  phone: {
    country: 'BD',
    pattern: '^01[0-9]{9}$',
    example: '01712345678',
    displayFormat: '+880 XXXXXXXXXX',
  },
  address: { fields: ['street', 'city'], order: ['street', 'city'] },
  academicYear: { startMonth: 1 },
  identifiers: { national: 'NID', student: 'Student ID' },
  timezone: 'Asia/Dhaka',
  calendar: { termLabel: 'TERM' },
};

// The tenant region is pinned to English: the default `RegionConfig` is Bangla.
function Mount({ region }: { region: MaskedRegionSettings }) {
  const [router] = React.useState(() =>
    createRouter({
      routeTree: createRootRoute({
        component: () => (
          <RegionConfigProvider value={REGION_BD_EN}>
            <RegionalSection schoolId={SCHOOL_ID} region={region} />
          </RegionConfigProvider>
        ),
      }),
      history: createMemoryHistory({ initialEntries: ['/'] }),
    }),
  );
  return <RouterProvider router={router} />;
}

function mount(region: MaskedRegionSettings = REGION) {
  return renderWithProviders(<Mount region={region} />, {
    locale: 'en',
    role: 'ADMIN',
    tenantId: SCHOOL_ID,
  });
}

describe('RegionalSection', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows plain words instead of codes for locale, first weekday and start month', async () => {
    mount();

    expect((await screen.findByLabelText('Language and number format')).textContent).toBe(
      'Bangla (Bangladesh)',
    );
    expect(screen.getByLabelText('First day of week').textContent).toBe('Sunday');
    expect(screen.getByLabelText('Academic year start month').textContent).toBe('January');
    expect(screen.queryByText('bn-BD')).toBeNull();
  });

  it('keeps an unknown stored locale selectable as "keep the current value"', async () => {
    mount({ ...REGION, locale: 'xx-XX' });

    expect((await screen.findByLabelText('Language and number format')).textContent).toBe(
      'Keep the current value',
    );
  });

  it('sends date.format and date.calendar unchanged from the stored region', async () => {
    const patchBody = vi.fn();
    server.use(
      http.patch('/api/v1/schools/:id/settings', async ({ request }) => {
        patchBody(await request.json());
        return HttpResponse.json({ version: 1, region: REGION });
      }),
    );
    const { user } = mount();

    await user.click(await screen.findByLabelText('First day of week'));
    await user.click(await screen.findByRole('option', { name: 'Saturday' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patchBody).toHaveBeenCalled());
    expect(patchBody.mock.calls[0]![0].region.date).toEqual({
      format: 'dd/MM/yyyy',
      calendar: 'gregorian',
      firstDayOfWeek: 6,
    });
  });

  it('opens the Advanced section when a field inside it is invalid', async () => {
    const { user, container } = mount();

    const pattern = await screen.findByLabelText('Phone number check rule');
    const details = container.querySelector('details')!;
    expect(details.open).toBe(false);
    await user.clear(pattern);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(details.open).toBe(true));
  });

  it('updates the money example when the grouping changes', async () => {
    const { user } = mount();

    expect(await screen.findByText('Example: ৳12,34,567.00')).toBeTruthy();
    await user.click(screen.getByLabelText('Number grouping'));
    await user.click(await screen.findByRole('option', { name: 'Thousand' }));

    expect(screen.getByText('Example: ৳1,234,567.00')).toBeTruthy();
  });

  it('saves with an empty student-ID rule (the server accepts it), but national stays required', async () => {
    const patchBody = vi.fn();
    server.use(
      http.patch('/api/v1/schools/:id/settings', async ({ request }) => {
        patchBody(await request.json());
        return HttpResponse.json({ version: 1, region: REGION });
      }),
    );
    const { user } = mount();

    await user.clear(await screen.findByLabelText(/^Student ID check rule/));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patchBody).toHaveBeenCalled());
    expect(patchBody.mock.calls[0]![0].region.identifiers.student).toBe('');

    patchBody.mockClear();
    await user.clear(screen.getByLabelText(/^National ID check rule/));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(screen.getByLabelText(/^National ID check rule/).getAttribute('aria-invalid')).toBe(
        'true',
      ),
    );
    expect(patchBody).not.toHaveBeenCalled();
  });

  it('shows a translated error, never the server text, when the save fails', async () => {
    server.use(failing('/api/v1/schools/:id/settings'));
    const { user } = mount();

    await user.click(await screen.findByRole('button', { name: 'Save' }));

    expect((await screen.findByRole('alert')).textContent).toBe("Couldn't save. Try again.");
    expect(screen.queryByText(SERVER_TEXT)).toBeNull();
  });
});
