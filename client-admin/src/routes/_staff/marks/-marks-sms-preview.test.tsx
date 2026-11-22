/** [80.3.03] Marks SMS review page and the grid's button. */
import { apiErrorBody, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

const SMS = '/api/v1/exams/exam-1/marks/sec-1/subj-1/sms';
const NEVER_SAY = ['recipient', 'audience', 'payload', 'segment', 'ledger', 'batch'];

const render = (role = 'TEACHER') =>
  renderWithRouter(routeTree, {
    initialEntries: ['/marks/exam-1/sec-1/subj-1/sms'],
    tenantId: 'tenant-1',
    role,
    locale: 'en',
  });

const baseGrid = (state: 'DRAFT' | 'SUBMITTED') => ({
  exam_id: 'exam-1',
  section_id: 'sec-1',
  subject_id: 'subj-1',
  state,
  submitted_by: null,
  submitted_at: null,
  students: [
    { id: 's1', roll_number: 1, full_name: 'Rafi Ahmed' },
    { id: 's2', roll_number: 2, full_name: 'Mina Akter' },
  ],
  components: [],
  cells: [],
  derived: {},
});

const stubPage = (preview: object, send?: () => Response) =>
  server.use(
    http.get('/api/v1/exams/exam-1/marks', () => HttpResponse.json(baseGrid('SUBMITTED'))),
    http.post(`${SMS}/preview`, () => HttpResponse.json(preview)),
    ...(send ? [http.post(SMS, send)] : []),
  );

describe('/marks/$examId/$sectionId/$subjectId/sms', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows counts, credits, skip reasons and the unpublished note, with no glossary term', async () => {
    stubPage({
      count: 3,
      segments: 4,
      skipped: [{ student_id: 's2', reason: 'no_reachable_guardian' }],
      already_sent_at: null,
    });
    const { container } = render();

    expect(await screen.findByText('3 guardians will get an SMS, 4 credits')).toBeTruthy();
    expect(screen.getByText(/Submitted, not yet published/)).toBeTruthy();
    expect(await screen.findByText('No guardian with a phone number')).toBeTruthy();
    const text = (container.textContent ?? '').toLowerCase();
    for (const word of NEVER_SAY) expect(text).not.toContain(word);
  });

  it('sends with an Idempotency-Key and then says it is sent', async () => {
    let key: string | null = null;
    stubPage({ count: 1, segments: 1, skipped: [], already_sent_at: null });
    server.use(
      http.post(SMS, ({ request }) => {
        key = request.headers.get('Idempotency-Key');
        return HttpResponse.json({ queued: 1, segments: 1, skipped: [], already_sent_at: null });
      }),
    );
    render();

    await userEvent.click(await screen.findByRole('button', { name: 'Send SMS' }));
    expect(await screen.findByText(/Sent\. 1 SMS are on the way/)).toBeTruthy();
    expect(key).toBeTruthy();
  });

  it('says "already sent on <date>" when nobody is left, and disables Send', async () => {
    stubPage({ count: 0, segments: 0, skipped: [], already_sent_at: '2026-11-10T04:00:00.000Z' });
    render();

    expect(await screen.findByText(/Already sent on/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send SMS' }).hasAttribute('disabled')).toBe(true);
  });

  it('shows our own sentence, never the server text, when credit is short', async () => {
    stubPage({ count: 2, segments: 5, skipped: [], already_sent_at: null }, () =>
      HttpResponse.json(
        {
          ...apiErrorBody(409, 'Insufficient SMS credit to send these marks.', SMS),
          details: { code: 'INSUFFICIENT_SMS_CREDIT', required: 5, available: 2 },
        },
        { status: 409 },
      ),
    );
    render();

    await userEvent.click(await screen.findByRole('button', { name: 'Send SMS' }));
    expect(
      await screen.findByText('Not enough SMS credit. 5 credits needed, 2 left.'),
    ).toBeTruthy();
    expect(screen.queryByText(/Insufficient SMS credit to send/)).toBeNull();
  });

  it('is refused to a role without MARKS_SMS_SEND', async () => {
    render('ACCOUNTANT');
    expect(await screen.findByText("You don't have access to this page.")).toBeTruthy();
  });
});

describe('grid page: Send marks SMS button', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  const grid = (role: string) =>
    renderWithRouter(routeTree, {
      initialEntries: ['/marks/exam-1/sec-1/subj-1'],
      tenantId: 'tenant-1',
      role,
      locale: 'en',
    });

  it('shows once the list is SUBMITTED for a holder of MARKS_SMS_SEND', async () => {
    server.use(
      http.get('/api/v1/exams/exam-1/marks', () => HttpResponse.json(baseGrid('SUBMITTED'))),
    );
    grid('TEACHER');
    expect(await screen.findByRole('button', { name: 'Send marks SMS to guardians' })).toBeTruthy();
  });

  it('is hidden while the list is a draft', async () => {
    server.use(http.get('/api/v1/exams/exam-1/marks', () => HttpResponse.json(baseGrid('DRAFT'))));
    grid('TEACHER');
    await screen.findByLabelText('Rafi Ahmed — Written').catch(() => undefined);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Send marks SMS to guardians' })).toBeNull(),
    );
  });

  it('is hidden without MARKS_SMS_SEND even when submitted', async () => {
    server.use(
      http.get('/api/v1/exams/exam-1/marks', () => HttpResponse.json(baseGrid('SUBMITTED'))),
    );
    grid('EXECUTIVE');
    await screen.findByRole('button', { name: /Download/ });
    expect(screen.queryByRole('button', { name: 'Send marks SMS to guardians' })).toBeNull();
  });
});
