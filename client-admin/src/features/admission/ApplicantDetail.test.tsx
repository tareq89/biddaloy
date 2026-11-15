import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { ApplicantDetail } from './ApplicantDetail';

afterEach(async () => {
  await cleanupTestState();
});

const root = createRootRoute();
const tree = root.addChildren([
  createRoute({
    getParentRoute: () => root,
    path: '/a',
    component: () => <ApplicantDetail applicantId="a1" />,
  }),
]);

function setup(proofs: object[]) {
  server.use(
    http.get('/api/v1/admission/applicants/a1', () =>
      HttpResponse.json({
        applicant: {
          id: 'a1',
          intake_id: 'r1',
          reference_number: 'ADM-1',
          applicant_name: 'Rahim',
          date_of_birth: '2015-01-01',
          gender: 'MALE',
          guardian_name: 'Karim',
          guardian_phone: '01700000000',
          guardian_email: null,
          home_address: null,
          documents: [],
          status: 'PENDING',
          created_at: '2027-01-01T00:00:00Z',
          updated_at: '2027-01-01T00:00:00Z',
          source: 'CLERK',
          quota_tags: ['FREEDOM_FIGHTER'],
          extra_fields: { ssc_gpa: '5.00', empty: '' },
          has_sibling: true,
          roll_number: null,
          fee_state: 'CONFIRMED',
        },
        evaluations: [],
      }),
    ),
    http.get('/api/v1/admission-intakes/r1', () => HttpResponse.json({ id: 'r1', title: 'Round' })),
    http.get('/api/v1/admission/fee-proofs', ({ request }) => {
      expect(new URL(request.url).searchParams.get('applicantId')).toBe('a1');
      return HttpResponse.json({
        data: proofs,
        total: proofs.length,
        page: 1,
        limit: 50,
        totalPages: 1,
      });
    }),
  );
  renderWithRouter(tree, {
    initialEntries: ['/a'],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
}

describe('ApplicantDetail Epic 71 fields', () => {
  it('shows source, quota, sibling, extra fields and the fee history', async () => {
    setup([
      {
        id: 'p1',
        state: 'SENT_BACK',
        method: 'BKASH',
        reference: 'TX1',
        reason: 'Blurry',
        created_at: '2027-01-02T00:00:00Z',
      },
    ]);
    expect(await screen.findByText('Entered by staff')).toBeTruthy();
    expect(screen.getByText('FREEDOM_FIGHTER')).toBeTruthy();
    expect(screen.getByText('Sibling in this school')).toBeTruthy();
    expect(screen.getByText('ssc_gpa')).toBeTruthy();
    expect(screen.getByText('5.00')).toBeTruthy();
    expect(await screen.findByText('Fee sent back')).toBeTruthy();
    expect(screen.getByText('Reason: Blurry')).toBeTruthy();
  });

  it('says so when there is no fee proof', async () => {
    setup([]);
    expect(await screen.findByText('No fee proof yet')).toBeTruthy();
  });
});
