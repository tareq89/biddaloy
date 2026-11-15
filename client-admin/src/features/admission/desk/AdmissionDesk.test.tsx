import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { AdmissionDesk } from './AdmissionDesk';

afterEach(async () => {
  await cleanupTestState();
});

const root = createRootRoute();
const desk = createRoute({
  getParentRoute: () => root,
  path: '/_staff/admissions/rounds/$roundId',
  validateSearch: (s: Record<string, unknown>) => ({
    step: typeof s.step === 'string' ? s.step : undefined,
  }),
  component: AdmissionDesk,
});
const tree = root.addChildren([desk]);

const page = (n: number) => ({ data: [], total: n, page: 1, limit: 1, totalPages: 1 });
function api(o: { applicants: number; feePending: number }) {
  server.use(
    http.get('/api/v1/admission-intakes/r1', () =>
      HttpResponse.json({
        id: 'r1',
        title: 'Class 1 admission 2027',
        status: 'OPEN',
        seat_count: 40,
      }),
    ),
    http.get('/api/v1/admission-intakes/r1/stages', () =>
      HttpResponse.json([{ id: 's1', kind: 'WRITTEN', title: null, position: 1 }]),
    ),
    http.get('/api/v1/admission/applicants', () => HttpResponse.json(page(o.applicants))),
    http.get('/api/v1/admission/fee-proofs', () => HttpResponse.json(page(o.feePending))),
    http.get('/api/v1/admission/intakes/r1/lists', () =>
      HttpResponse.json({ seat_count: 40, seats_left: 40, lists: [] }),
    ),
  );
}
const render = (search = '') =>
  renderWithRouter(tree, {
    initialEntries: [`/_staff/admissions/rounds/r1${search}`],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });

describe('AdmissionDesk', () => {
  it('shows counts, the fee card first, and the applicants panel', async () => {
    api({ applicants: 12, feePending: 3 });
    render();
    expect(await screen.findByText(/[3৩] fee checks pending/)).toBeTruthy();
    expect(screen.getByText(/^(12|১২)$/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Applicants' })).toBeTruthy();
  });

  it('?step= selects the panel', async () => {
    api({ applicants: 12, feePending: 3 });
    render('?step=merit');
    expect(await screen.findByRole('heading', { name: 'Merit and waiting lists' })).toBeTruthy();
  });

  it('empty round says no application yet', async () => {
    api({ applicants: 0, feePending: 0 });
    render();
    expect(await screen.findByText('No application yet')).toBeTruthy();
  });

  it('arrow keys move between steps', async () => {
    api({ applicants: 12, feePending: 0 });
    render();
    const first = (await screen.findAllByRole('button', { name: /Applications/ }))[0];
    first?.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(
      (await screen.findAllByRole('button', { name: /Written test/ }))[0]?.getAttribute(
        'aria-current',
      ),
    ).toBe('step');
  });
});
