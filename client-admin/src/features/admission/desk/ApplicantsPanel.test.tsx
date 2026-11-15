import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { ApplicantsPanel } from './ApplicantsPanel';

afterEach(async () => {
  await cleanupTestState();
});

const root = createRootRoute();
const tree = root.addChildren([
  createRoute({
    getParentRoute: () => root,
    path: '/rounds/$roundId',
    component: ApplicantsPanel,
  }),
]);

function setup(awaiting: number, applicants: object[] = [], stages: object[] = []) {
  const applicantQueries: URLSearchParams[] = [];
  server.use(
    http.get('/api/v1/admission-intakes/r1', () =>
      HttpResponse.json({ id: 'r1', title: 'Round', status: 'OPEN', fee_amount_paisa: 50000 }),
    ),
    http.get('/api/v1/admission-intakes', () => HttpResponse.json([])),
    http.get('/api/v1/admission-intakes/r1/stages', () => HttpResponse.json(stages)),
    http.get('/api/v1/admission/fee-proofs', ({ request }) => {
      const limit = Number(new URL(request.url).searchParams.get('limit'));
      const row = {
        id: 'p1',
        applicant_id: 'a1',
        intake_id: 'r1',
        applicant_name: 'Rahim',
        applicant_reference_number: 'ADM-1',
        applicant_status: 'FEE_PENDING',
        method: 'BKASH',
        reference: 'TX1',
        state: 'AWAITING',
        reason: null,
        created_at: '2027-01-01T00:00:00Z',
        seen_before: 0,
      };
      return HttpResponse.json({
        data: awaiting > 0 && limit > 1 ? [row] : [],
        total: awaiting,
        page: 1,
        limit,
        totalPages: 1,
      });
    }),
    http.get('/api/v1/admission/applicants', ({ request }) => {
      applicantQueries.push(new URL(request.url).searchParams);
      return HttpResponse.json({
        data: applicants,
        total: applicants.length,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
    }),
  );
  renderWithRouter(tree, {
    initialEntries: ['/rounds/r1'],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
  return applicantQueries;
}

describe('ApplicantsPanel', () => {
  it('chip shows the awaiting total (Bangla digits in this region) and opens the queue', async () => {
    setup(3);
    await userEvent.click(await screen.findByRole('button', { name: /Check fees \(.\)/ }));
    expect(await screen.findByText('Rahim')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Check' })).toBeTruthy();
  });

  it('chip is hidden at zero', async () => {
    setup(0);
    await screen.findByRole('link', { name: 'New application' });
    expect(screen.queryByRole('button', { name: /Check fees/ })).toBeNull();
  });

  it('lists only this round', async () => {
    const queries = setup(0);
    await screen.findByRole('link', { name: 'New application' });
    await expect.poll(() => queries.length).toBeGreaterThan(0);
    expect(queries[0]!.get('intakeId')).toBe('r1');
  });

  it('sends the fee, quota and source filters and shows removable chips', async () => {
    const queries = setup(0);
    await screen.findByRole('link', { name: 'New application' });
    await userEvent.click(await screen.findByRole('combobox', { name: 'Fee' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Fee ok' }));
    await expect.poll(() => queries.at(-1)!.get('fee_state')).toBe('CONFIRMED');
    const chip = await screen.findByRole('button', { name: /Remove filter.*Fee ok/ });
    await userEvent.click(chip);
    // The unfiltered list is cached, so no new request: the chip going away is the signal.
    await expect
      .poll(() => screen.queryByRole('button', { name: /Remove filter.*Fee ok/ }))
      .toBeNull();
  });

  it('prompts for roll numbers when a test stage exists and some applicants have none', async () => {
    setup(
      0,
      [
        { id: 'a1', roll_number: null, status: 'PENDING' },
        { id: 'a2', roll_number: '5', status: 'PENDING' },
        { id: 'a3', roll_number: null, status: 'FEE_PENDING' },
      ],
      [{ id: 's1', kind: 'WRITTEN', title: 'Written', position: 1 }],
    );
    expect(await screen.findByText(/have no roll number yet/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Make roll numbers' })).toBeTruthy();
  });

  it('hides the roll card when every applicant has a roll', async () => {
    setup(
      0,
      [{ id: 'a2', roll_number: '5', status: 'PENDING' }],
      [{ id: 's1', kind: 'WRITTEN', title: 'Written', position: 1 }],
    );
    await screen.findByRole('link', { name: 'New application' });
    expect(screen.queryByText(/have no roll number yet/)).toBeNull();
  });
});
