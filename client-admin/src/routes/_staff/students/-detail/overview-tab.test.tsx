import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server, studentFactory } from '@biddaloy/ui/test';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { OverviewTab } from './overview-tab';

const ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

afterEach(async () => {
  await cleanupTestState();
});

function view() {
  return renderWithProviders(<OverviewTab studentId={ID} />, {
    locale: 'en',
    role: 'ADMIN',
    tenantId: 'tenant-1',
  });
}

describe('OverviewTab: photo consent', () => {
  it.each([
    ['GIVEN', 'Given'],
    ['REFUSED', 'Refused'],
    ['UNKNOWN', 'Not recorded'],
  ] as const)('shows %s as "%s", never the raw code', async (value, label) => {
    server.use(
      http.get(`/api/v1/students/${ID}`, () =>
        HttpResponse.json(studentFactory({ id: ID, photo_consent: value })),
      ),
    );
    const v = view();
    expect(await v.findByText(label)).toBeTruthy();
    expect(v.queryByText(value)).toBeNull();
    expect(v.getByText('Photo consent')).toBeTruthy();
  });

  it('shows who and when, muted, once recorded', async () => {
    server.use(
      http.get(`/api/v1/students/${ID}`, () =>
        HttpResponse.json(
          studentFactory({
            id: ID,
            photo_consent: 'GIVEN',
            photo_consent_recorded_at: '2026-03-04T05:00:00.000Z',
            photo_consent_recorded_by_user: { email: 'office@school.test' } as never,
          }),
        ),
      ),
    );
    expect(await view().findByText(/office@school\.test/)).toBeTruthy();
  });
});
