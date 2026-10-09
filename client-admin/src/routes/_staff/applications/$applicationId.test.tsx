import type { ApplicationDto } from '@biddaloy/ui/hooks';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

import { applicationDto } from './-detail/-application-fixture';

const ID = '7c1e0000-0000-4000-8000-000000000001';

function render(dto: ApplicationDto, search = '') {
  server.use(http.get('/api/v1/applications/:id', () => HttpResponse.json(dto)));
  return renderWithRouter(routeTree, {
    initialEntries: [`/applications/${dto.id}${search}`],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
}

describe('/applications/$applicationId', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('a decider sees Approve and Reject', async () => {
    render(applicationDto());
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Withdraw' })).toBeNull();
  });

  it('the applicant sees Withdraw only', async () => {
    render(
      applicationDto({
        can: { decide: false, consider: false, withdraw: true, cancel: false, comment: false },
      }),
    );
    expect(await screen.findByRole('button', { name: 'Withdraw' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('a tagged user can comment but not decide', async () => {
    render(
      applicationDto({
        can: { decide: false, consider: false, withdraw: false, cancel: false, comment: true },
      }),
    );
    expect(await screen.findByLabelText('Write a comment')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('renders the stored letter and shows note text, not HTML', async () => {
    render(
      applicationDto({
        events: [
          ...applicationDto().events,
          {
            id: 'e-2',
            kind: 'COMMENT',
            step: null,
            actor_user_id: 'u-2',
            actor_name: 'Salma',
            note: '<b>bold</b>',
            data: null,
            created_at: '2026-10-02T04:00:00.000Z',
          },
        ],
      }),
    );
    expect(await screen.findByText('Please waive the fee.')).toBeTruthy();
    expect(screen.getByText('<b>bold</b>')).toBeTruthy();
  });

  it('writes one sentence per event kind and notes a skipped step', async () => {
    const base = { step: 0, actor_user_id: 'u', actor_name: 'Salma', note: null, data: null };
    render(
      applicationDto({
        events: [
          {
            ...base,
            id: 'a',
            kind: 'STEP_APPROVED',
            created_at: '2026-10-02T04:00:00.000Z',
            data: { skipped_steps: [0] },
          },
          {
            ...base,
            id: 'b',
            kind: 'REJECTED',
            note: 'No funds',
            created_at: '2026-10-03T04:00:00.000Z',
          },
          { ...base, id: 'c', kind: 'CANCELLED', created_at: '2026-10-04T04:00:00.000Z' },
        ],
      }),
    );
    expect(await screen.findByText('Salma approved step 1')).toBeTruthy();
    expect(screen.getByText("The class teacher's step was skipped")).toBeTruthy();
    expect(screen.getByText('Salma rejected')).toBeTruthy();
    expect(screen.getByText('Reason: No funds')).toBeTruthy();
    expect(screen.getByText('Salma cancelled the leave')).toBeTruthy();
  });

  it('an approved TESTIMONIAL links its print follow-up', async () => {
    render(
      applicationDto({
        type: 'TESTIMONIAL',
        status: 'APPROVED',
        decided_by_name: 'Head',
        decided_at: '2026-10-05T04:00:00.000Z',
        payload: { purpose: 'College' },
        can: { decide: false, consider: false, withdraw: false, cancel: false, comment: false },
        effect_result: {
          follow_up: {
            kind: 'PRINT',
            document_kind: 'TESTIMONIAL',
            subject_type: 'STUDENT',
            subject_ids: ['s-1'],
          },
        },
      }),
    );
    const link = await screen.findByRole('link', { name: 'Print Testimonial' });
    const href = link.getAttribute('href') ?? '';
    expect(href).toContain('/print/preview?kind=TESTIMONIAL&subject_type=STUDENT&ids=s-1');
    expect(href).toContain(`from=%2Fapplications%2F${ID}`);
  });

  it('an approved SCRIPT_RECHECK links to the marks sheet', async () => {
    render(
      applicationDto({
        type: 'SCRIPT_RECHECK',
        status: 'APPROVED',
        decided_by_name: 'Head',
        decided_at: '2026-10-05T04:00:00.000Z',
        payload: { reason: 'x' },
        can: { decide: false, consider: false, withdraw: false, cancel: false, comment: false },
        effect_result: {
          follow_up: { kind: 'MARKS', exam_id: 'ex1', section_id: 'sec1', subject_id: 'sub1' },
        },
      }),
    );
    const link = await screen.findByRole('link', { name: 'View marks' });
    expect(link.getAttribute('href')).toBe('/marks/ex1/sec1/sub1');
  });

  it('an approved teacher leave links to the substitute screen', async () => {
    render(
      applicationDto({
        type: 'STAFF_LEAVE',
        status: 'APPROVED',
        subject_kind: 'STAFF',
        decided_by_name: 'Head',
        decided_at: '2026-10-05T04:00:00.000Z',
        payload: {
          leave_type: 'CASUAL',
          start_date: '2026-10-12',
          end_date: '2026-10-14',
          reason: 'x',
        },
        can: { decide: false, consider: false, withdraw: false, cancel: false, comment: false },
        effect_result: {
          follow_up: {
            kind: 'SUBSTITUTE',
            from: '2026-10-12',
            to: '2026-10-14',
            covered_for_teacher_id: 't-1',
          },
        },
      }),
    );
    const link = await screen.findByRole('link', { name: 'Arrange a substitute' });
    expect(link.getAttribute('href')).toBe(
      '/routines/substitutions?from=2026-10-12&to=2026-10-14&covered_for_teacher_id=t-1',
    );
  });

  it('from=inbox focuses Approve; Enter opens it and Enter in the note posts, then returns to the inbox', async () => {
    let body: unknown;
    server.use(
      http.post('/api/v1/applications/:id/approve', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(applicationDto({ status: 'APPROVED' }));
      }),
    );
    const { router } = render(
      applicationDto({ type: 'STAFF_LEAVE', payload: { leave_type: 'CASUAL' } }),
      '?from=inbox',
    );
    const approve = await screen.findByRole('button', { name: 'Approve' });
    await waitFor(() => expect(document.activeElement).toBe(approve), { timeout: 2000 });

    const user = userEvent.setup();
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Note (optional)'), 'ok{Enter}');
    await waitFor(() => expect(body).toEqual({ note: 'ok' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/applications'));
    expect(router.state.location.search).toMatchObject({ view: 'inbox', decided: ID });
  });

  it('?decide=reject opens the reject dialog', async () => {
    render(applicationDto(), '?decide=reject');
    expect(await screen.findByRole('dialog', { name: 'Reject this application?' })).toBeTruthy();
  });

  it('a 404 shows the not-found state', async () => {
    server.use(
      http.get('/api/v1/applications/:id', () =>
        HttpResponse.json(
          {
            statusCode: 404,
            message: 'Not found',
            timestamp: new Date().toISOString(),
            path: '/x',
            requestId: 'r',
          },
          { status: 404 },
        ),
      ),
    );
    renderWithRouter(routeTree, {
      initialEntries: [`/applications/${ID}`],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    expect(await screen.findByText('This application could not be found')).toBeTruthy();
  });
});
