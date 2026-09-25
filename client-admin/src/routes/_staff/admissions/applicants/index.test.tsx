import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

/**
 * [27.10] Admission applicants staff screen. Every case names a `role`
 * since `/admissions/applicants` sits under `_staff` and is gated by
 * `ADMISSION_REVIEW` (`route-permissions.ts`), same pattern as
 * `admissions/intakes/index.test.tsx` (#27.9).
 */
describe('/admissions/applicants', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  const applicant = {
    id: 'applicant-1',
    intake_id: 'intake-1',
    reference_number: 'REF-001',
    applicant_name: 'Jane Doe',
    date_of_birth: '2015-01-01',
    gender: 'FEMALE',
    guardian_name: 'John Doe',
    guardian_phone: '01700000000',
    guardian_email: null,
    home_address: null,
    documents: [],
    status: 'PENDING',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };

  function mockIntakes() {
    server.use(http.get('/api/v1/admission-intakes', () => HttpResponse.json([])));
  }

  it('lists applicants and links to the detail screen', async () => {
    mockIntakes();
    server.use(http.get('/api/v1/admission/applicants', () => HttpResponse.json([applicant])));

    renderWithRouter(routeTree, {
      initialEntries: ['/admissions/applicants'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('heading', { name: 'Admission applicants' });
    expect(await screen.findByText('REF-001')).toBeTruthy();
    expect(screen.getByText('Jane Doe')).toBeTruthy();
  });

  it('refuses the whole route for TEACHER, who lacks ADMISSION_REVIEW', async () => {
    mockIntakes();
    server.use(http.get('/api/v1/admission/applicants', () => HttpResponse.json([])));

    renderWithRouter(routeTree, {
      initialEntries: ['/admissions/applicants'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    expect(await screen.findByText("You don't have access to this page.")).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Admission applicants' })).toBeNull();
  });

  it('shortlists an applicant from the detail screen', async () => {
    mockIntakes();
    let current = { ...applicant };
    server.use(
      http.get('/api/v1/admission/applicants/:id', () =>
        HttpResponse.json({ applicant: current, evaluations: [] }),
      ),
      http.post('/api/v1/admission/applicants/:id/evaluate', async ({ request }) => {
        const body = (await request.json()) as { notes: string; decision?: string };
        current = {
          ...current,
          status: body.decision === 'SHORTLIST' ? 'SHORTLISTED' : current.status,
        };
        return HttpResponse.json(current);
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/admissions/applicants/applicant-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('heading', { name: 'Jane Doe' });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Shortlist' }));

    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByLabelText('Notes'), 'Looks good');
    await user.click(dialog.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(current.status).toBe('SHORTLISTED'));
  });

  it('admits an applicant, creating a student+guardian, via the confirm modal', async () => {
    mockIntakes();
    let current = { ...applicant };
    let admitCalls = 0;
    server.use(
      http.get('/api/v1/admission/applicants/:id', () =>
        HttpResponse.json({ applicant: current, evaluations: [] }),
      ),
      http.post('/api/v1/admission/applicants/:id/admit', () => {
        admitCalls += 1;
        current = { ...current, status: 'ADMITTED' };
        return HttpResponse.json(current);
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/admissions/applicants/applicant-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('heading', { name: 'Jane Doe' });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Admit' }));

    const dialog = within(await screen.findByRole('dialog'));
    // Guardian details shown pre-commit — the agreed substitute for a true
    // existing/new preview, since no server endpoint answers that ahead of time.
    expect(dialog.getByText('John Doe')).toBeTruthy();
    expect(dialog.getByText('01700000000')).toBeTruthy();
    await user.click(dialog.getByRole('button', { name: 'Admit' }));

    await waitFor(() => expect(admitCalls).toBe(1));
    await waitFor(() => expect(current.status).toBe('ADMITTED'));
    expect(await screen.findByRole('status')).toBeTruthy();
  });

  it('rejects an applicant with no student created', async () => {
    mockIntakes();
    let current = { ...applicant };
    let admitCalls = 0;
    server.use(
      http.get('/api/v1/admission/applicants/:id', () =>
        HttpResponse.json({ applicant: current, evaluations: [] }),
      ),
      http.post('/api/v1/admission/applicants/:id/admit', () => {
        admitCalls += 1;
        return HttpResponse.json({ ...current, status: 'ADMITTED' });
      }),
      http.post('/api/v1/admission/applicants/:id/reject', async ({ request }) => {
        const body = (await request.json()) as { notes?: string };
        current = { ...current, status: 'REJECTED' };
        expect(body.notes).toBe('No seats');
        return HttpResponse.json(current);
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/admissions/applicants/applicant-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('heading', { name: 'Jane Doe' });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Reject' }));

    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByLabelText('Notes'), 'No seats');
    await user.click(dialog.getByRole('button', { name: 'Reject' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(current.status).toBe('REJECTED'));
    expect(admitCalls).toBe(0);
  });
});
