import {
  classFactory,
  classSectionFactory,
  cleanupTestState,
  renderWithRouter,
  server,
  studentFactory,
} from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

const SID = '8b7e0000-0000-4000-8000-000000000001';
const FATIMA = studentFactory({
  id: SID,
  full_name: 'Fatima Rahman',
  class_section: classSectionFactory({
    section_name: 'A',
    class: classFactory({ name: 'Class 6' }),
  }),
});

function render(search = `?student=${SID}`, role = 'PARENT') {
  const seen = { create: [] as Record<string, unknown>[], preview: 0, upload: 0 };
  server.use(
    http.get('/api/v1/students/mine', () => HttpResponse.json([FATIMA])),
    http.get('/api/v1/applications/addressees', () =>
      HttpResponse.json([
        { addressee: 'CLASS_TEACHER', user: { id: 'u-t', full_name: 'Teacher Tina' }, role: null },
        { addressee: 'HEADMASTER', user: null, role: 'ADMIN' },
        { addressee: 'OFFICE', user: null, role: 'OFFICE_STAFF' },
        { addressee: 'STAFF_USER', user: null, role: null },
      ]),
    ),
    http.post('/api/v1/applications/letter-preview', () => {
      seen.preview += 1;
      return HttpResponse.json({ letter_text: 'Dear Sir, the draft.', letter_locale: 'en' });
    }),
    http.post('/api/v1/applications', async ({ request }) => {
      seen.create.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json(
        { id: 'app-1', serial: '2026/0046', status: 'PENDING' },
        { status: 201 },
      );
    }),
    http.post('/api/v1/applications/:id/attachments', () => {
      seen.upload += 1;
      return HttpResponse.json([]);
    }),
    http.get('/api/v1/applications/:id', () =>
      HttpResponse.json({ message: 'x' }, { status: 404 }),
    ),
  );
  const r = renderWithRouter(routeTree, {
    initialEntries: [`/portal/applications/new${search}`],
    tenantId: 'tenant-1',
    role,
    locale: 'en',
  });
  return Object.assign(seen, { router: r.router });
}

const next = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'Next' }));

describe('/portal/applications/new', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('offers only student-subject types the family can fill', async () => {
    render();
    expect(await screen.findByRole('radio', { name: /Student leave/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Testimonial/ })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: /Staff leave/ })).toBeNull();
    // Needs a class / exam picker a family cannot load (canFillApplicationType).
    expect(screen.queryByRole('radio', { name: /Section change/ })).toBeNull();
    expect(screen.queryByRole('radio', { name: /Readmission/ })).toBeNull();
    expect(screen.queryByRole('radio', { name: /Script recheck/ })).toBeNull();
  });

  it('files an application without on_behalf_of_user_id or tags, then opens it', async () => {
    const seen = render(`?student=${SID}&type=ID_CARD_REPRINT`);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/^Reason/), 'Lost it');
    await next(user);
    await next(user); // attachments, none
    expect(await screen.findByText('Dear Sir, the draft.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Submit application' }));
    await waitFor(() => expect(seen.create).toHaveLength(1));
    expect(seen.create[0]).toMatchObject({
      type: 'ID_CARD_REPRINT',
      subject_student_id: SID,
      payload: { reason: 'Lost it' },
    });
    expect(seen.create[0]).not.toHaveProperty('on_behalf_of_user_id');
    expect(seen.create[0]).not.toHaveProperty('tags');
    await waitFor(() =>
      expect(seen.router.state.location.pathname).toBe('/portal/applications/app-1'),
    );
  });

  it('GENERAL needs an addressee and never offers a named staff member', async () => {
    const seen = render(`?student=${SID}&type=GENERAL`);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/^Subject/), 'A request');
    await user.type(screen.getByLabelText(/^Application/), 'Please help.');
    await next(user);
    expect(await screen.findByText('Choose who the letter is for')).toBeTruthy();
    expect(seen.create).toHaveLength(0);
    expect(screen.queryByRole('radio', { name: /specific staff member/ })).toBeNull();
    await user.click(screen.getByRole('radio', { name: /Headmaster/ }));
    await next(user);
    await next(user);
    await user.click(await screen.findByRole('button', { name: 'Submit application' }));
    await waitFor(() => expect(seen.create).toHaveLength(1));
    expect(seen.create[0]).toMatchObject({ type: 'GENERAL', addressee: 'HEADMASTER' });
    expect(seen.create[0]).not.toHaveProperty('addressee_user_id');
  });

  it('refuses a 4th attachment before any request', async () => {
    const seen = render(`?student=${SID}&type=ID_CARD_REPRINT`);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/^Reason/), 'Lost it');
    await next(user);
    const pdf = (name: string) => new File(['x'], name, { type: 'application/pdf' });
    await user.upload(await screen.findByLabelText('Attach files'), [
      pdf('a.pdf'),
      pdf('b.pdf'),
      pdf('c.pdf'),
      pdf('d.pdf'),
    ]);
    expect(await screen.findByText('At most 3 files')).toBeTruthy();
    expect(seen.create).toHaveLength(0);
    expect(seen.upload).toBe(0);
  });

  it('a failed upload after the create freezes the flow: retry the upload or open it', async () => {
    const seen = render(`?student=${SID}&type=ID_CARD_REPRINT`);
    server.use(
      http.post('/api/v1/applications/:id/attachments', () => {
        seen.upload += 1;
        return HttpResponse.json({ message: 'x' }, { status: 500 });
      }),
    );
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/^Reason/), 'Lost it');
    await next(user);
    await user.upload(
      await screen.findByLabelText('Attach files'),
      new File(['x'], 'a.pdf', { type: 'application/pdf' }),
    );
    await next(user);
    await user.click(await screen.findByRole('button', { name: 'Submit application' }));

    const retry = await screen.findByRole('button', { name: 'Retry attaching files' });
    // No Back (edits would be thrown away) and no discard prompt: the application exists.
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open the application' })).toBeTruthy();
    await user.click(retry);
    await waitFor(() => expect(seen.upload).toBe(2));
    expect(seen.create).toHaveLength(1);
  });

  it('a student that is not one of mine goes back to the list', async () => {
    const seen = render('?student=11111111-1111-4111-8111-111111111111');
    await waitFor(() => expect(seen.router.state.location.pathname).toBe('/portal/applications'));
  });
});
