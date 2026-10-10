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

  it('FEE_WAIVER: "Approved amount" shows only when the approver changed the amount', async () => {
    const asked = { kind: 'FLAT', value: 200, reason: 'Hard year' };
    // `granted` never carries the applicant's `reason`; that alone is no change.
    const view = render(
      applicationDto({
        type: 'FEE_WAIVER',
        payload: asked,
        granted: { kind: 'FLAT', value: 200 },
      }),
    );
    expect(await screen.findByText('Amount')).toBeTruthy();
    expect(screen.queryByText('Approved amount')).toBeNull();
    view.unmount();
    await cleanupTestState();
    render(
      applicationDto({
        type: 'FEE_WAIVER',
        payload: asked,
        granted: { kind: 'FLAT', value: 150 },
      }),
    );
    expect(await screen.findByText('Approved amount')).toBeTruthy();
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

  it('shows the crumb and document title as "<type> — <applicant>"', async () => {
    render(applicationDto());
    await screen.findByRole('heading', { level: 1, name: 'Fee waiver — Rahim Uddin' });
    await waitFor(() => expect(document.title).toContain('Fee waiver — Rahim Uddin'));
    const crumbs = document.querySelector<HTMLElement>('[data-slot="breadcrumbs"]');
    expect(crumbs).not.toBeNull();
    expect(await within(crumbs as HTMLElement).findByText('Fee waiver — Rahim Uddin')).toBeTruthy();
  });

  it('puts Cancel leave under More actions, not in the header row', async () => {
    render(
      applicationDto({
        type: 'STAFF_LEAVE',
        status: 'APPROVED',
        payload: { leave_type: 'CASUAL' },
        can: { decide: false, consider: false, withdraw: false, cancel: true, comment: false },
      }),
    );
    const more = await screen.findByRole('button', { name: /more actions/i });
    expect(screen.queryByRole('button', { name: 'Cancel leave' })).toBeNull();
    await userEvent.setup().click(more);
    expect(await screen.findByRole('menuitem', { name: 'Cancel leave' })).toBeTruthy();
  });

  const file = {
    id: 'f-1',
    file_name: 'proof.pdf',
    mime_type: 'application/pdf',
    size_bytes: 2048,
    uploaded_by_user_id: 'u-1',
    created_at: '2026-10-01T04:00:00.000Z',
  };

  it('the applicant deletes an attachment while PENDING, after confirming', async () => {
    let deleted = false;
    server.use(
      http.delete('/api/v1/applications/:id/attachments/:fileId', () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    render(
      applicationDto({
        attachments: [file],
        can: { decide: false, consider: false, withdraw: true, cancel: false, comment: false },
      }),
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Delete — proof.pdf' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deleted).toBe(true));
  });

  it('no delete icon for a decider, or once the application is decided', async () => {
    const { unmount } = render(applicationDto({ attachments: [file] }));
    await screen.findByRole('button', { name: 'Download — proof.pdf' });
    expect(screen.queryByRole('button', { name: 'Delete — proof.pdf' })).toBeNull();
    unmount();
    render(
      applicationDto({
        attachments: [file],
        status: 'APPROVED',
        can: { decide: false, consider: false, withdraw: true, cancel: false, comment: false },
      }),
    );
    await screen.findByRole('button', { name: 'Download — proof.pdf' });
    expect(screen.queryByRole('button', { name: 'Delete — proof.pdf' })).toBeNull();
  });

  async function pickPerson(user: ReturnType<typeof userEvent.setup>) {
    server.use(
      http.get('/api/v1/applications/tag-options', () =>
        HttpResponse.json({
          users: [{ id: 'u-9', full_name: 'Salma Khatun', role: 'ACCOUNTANT' }],
          roles: [],
        }),
      ),
    );
    await user.click(await screen.findByRole('button', { name: 'Add more people' }));
    await user.type(screen.getByRole('combobox', { name: 'Tag people' }), 'Sal');
    await user.click(await screen.findByRole('option', { name: /Salma Khatun/ }));
  }

  it('tags a person and sends the user id', async () => {
    let body: unknown;
    server.use(
      http.post('/api/v1/applications/:id/tags', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(applicationDto());
      }),
    );
    render(applicationDto());
    const user = userEvent.setup();
    await pickPerson(user);
    await user.click(screen.getByRole('button', { name: 'Add more people' }));
    await waitFor(() => expect(body).toEqual({ tags: [{ user_id: 'u-9' }] }));
  });

  it('a tag the server refuses shows the specific translated sentence', async () => {
    server.use(
      http.post('/api/v1/applications/:id/tags', () =>
        HttpResponse.json(
          {
            statusCode: 422,
            message: 'raw',
            details: { code: 'APPLICATION_TAGS_STAFF_ONLY' },
            timestamp: new Date().toISOString(),
            path: '/x',
            requestId: 'r',
          },
          { status: 422 },
        ),
      ),
    );
    render(applicationDto());
    const user = userEvent.setup();
    await pickPerson(user);
    await user.click(screen.getByRole('button', { name: 'Add more people' }));
    expect(await screen.findByText('Only staff members can be tagged.')).toBeTruthy();
  });
});
