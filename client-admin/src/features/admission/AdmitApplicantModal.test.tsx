import type { AdmissionApplicantDto } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { AdmitApplicantModal } from './AdmitApplicantModal';

afterEach(async () => {
  await cleanupTestState();
});

describe('AdmitApplicantModal section picker', () => {
  it('lists only the round class sections and sends the chosen one', async () => {
    const bodies: Record<string, unknown>[] = [];
    let sectionsPath = '';
    server.use(
      http.get('/api/v1/admission-intakes/r1', () =>
        HttpResponse.json({ id: 'r1', title: 'Round', class_id: 'c1' }),
      ),
      http.get('/api/v1/classes/:classId/sections', ({ params }) => {
        sectionsPath = String(params.classId);
        return HttpResponse.json([
          { id: 's1', section_name: 'A', enrolled_count: 0 },
          { id: 's2', section_name: 'B', enrolled_count: 0 },
        ]);
      }),
      http.get('/api/v1/admission/applicants/a1/guardian-match', () =>
        HttpResponse.json({ guardian: null }),
      ),
      http.post('/api/v1/admission/applicants/a1/admit', async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({});
      }),
    );
    const applicant = {
      id: 'a1',
      intake_id: 'r1',
      applicant_name: 'Rahim',
      guardian_name: 'G',
      guardian_phone: '+8801711111111',
      status: 'SHORTLISTED',
    } as AdmissionApplicantDto;
    const root = createRootRoute();
    const tree = root.addChildren([
      createRoute({
        getParentRoute: () => root,
        path: '/',
        component: () => (
          <AdmitApplicantModal applicant={applicant} open onOpenChange={() => undefined} />
        ),
      }),
    ]);
    renderWithRouter(tree, {
      initialEntries: ['/'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    await userEvent.click(await screen.findByRole('combobox', { name: 'Section' }));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Let the school choose',
      'A',
      'B',
    ]);
    await userEvent.click(screen.getByRole('option', { name: 'B' }));
    const admit = screen.getByRole('button', { name: 'Admit' });
    await waitFor(() => expect((admit as HTMLButtonElement).disabled).toBe(false));
    await userEvent.click(admit);
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(sectionsPath).toBe('c1');
    expect(bodies[0]).toEqual({ class_section_id: 's2' });
  });
});
