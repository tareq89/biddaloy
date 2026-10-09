import {
  apiErrorBody,
  cleanupTestState,
  renderWithRouter,
  server,
  userResponseFactory,
} from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

const page = (data: unknown[]) => ({ data, total: data.length, page: 1, limit: 20, totalPages: 1 });

const STUDENT = {
  id: '3e5a0000-0000-4000-8000-000000000001',
  full_name: 'Rahim Uddin',
  user_id: null,
  class_section_id: 'sec-a',
  class_section: {
    id: 'sec-a',
    class_id: 'c1',
    class: { id: 'c1', name: 'Six' },
    section_name: 'A',
  },
  guardians: [
    { id: 'g1', user_id: 'u-g1', full_name: 'Karim Uddin', relationship: 'Father' },
    { id: 'g2', user_id: null, full_name: 'No Login', relationship: 'Uncle' },
  ],
};

interface Captured {
  create: Record<string, unknown>[];
  upload: number;
  preview: Record<string, unknown>[];
}

function render(
  role: string,
  { profile = 'sp-me', search = '', uploadFails = false } = {},
): Captured & { router: ReturnType<typeof renderWithRouter>['router'] } {
  const seen: Captured = { create: [], upload: 0, preview: [] };
  server.use(
    http.get('/api/v1/users/me', () =>
      HttpResponse.json(
        userResponseFactory({
          id: 'u-me',
          full_name: 'Me Myself',
          staff_profile_id: profile || null,
        }),
      ),
    ),
    http.get('/api/v1/students', () => HttpResponse.json(page([STUDENT]))),
    http.get('/api/v1/students/:id', () => HttpResponse.json(STUDENT)),
    http.get('/api/v1/users', () =>
      HttpResponse.json(page([{ id: 'u-t', full_name: 'Teacher Tina', staff_profile_id: 'sp-t' }])),
    ),
    http.get('/api/v1/applications/addressees', () =>
      HttpResponse.json([
        { addressee: 'HEADMASTER', user: null, role: 'ADMIN' },
        { addressee: 'OFFICE', user: null, role: 'OFFICE_STAFF' },
        { addressee: 'STAFF_USER', user: null, role: null },
      ]),
    ),
    http.post('/api/v1/applications/letter-preview', async ({ request }) => {
      seen.preview.push((await request.json()) as Record<string, unknown>);
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
      return uploadFails
        ? HttpResponse.json(
            {
              ...apiErrorBody(409, 'raw server text', '/api/v1/applications/app-1/attachments'),
              details: { code: 'APPLICATION_ATTACHMENT_LIMIT' },
            },
            { status: 409 },
          )
        : HttpResponse.json([]);
    }),
    http.get('/api/v1/applications/:id', () =>
      HttpResponse.json({ message: 'x' }, { status: 404 }),
    ),
  );
  const r = renderWithRouter(routeTree, {
    initialEntries: [`/applications/new${search}`],
    tenantId: 'tenant-1',
    role,
    locale: 'en',
  });
  return Object.assign(seen, { router: r.router });
}

const next = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'Next' }));

describe('/applications/new', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('a teacher cannot file student types; staff types stay enabled', async () => {
    render('TEACHER');
    const testimonial = await screen.findByRole('radio', { name: 'Testimonial' });
    expect((testimonial as HTMLButtonElement).disabled).toBe(true);
    expect(
      screen.getAllByText('Applications on behalf of a student are recorded by the office').length,
    ).toBeGreaterThan(0);
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Staff leave' })).toHaveProperty('disabled', false),
    );
  });

  it('?type=STAFF_LEAVE starts at step 2 with the own profile as subject', async () => {
    render('TEACHER', { search: '?type=STAFF_LEAVE' });
    expect(await screen.findByText('Step 2 of 5')).toBeTruthy();
    expect(screen.getByText('For myself')).toBeTruthy();
    expect(document.title).toBe('New application · Applications · SchoolManager');
  });

  it('GENERAL: addressee is required; a staff addressee and the draft letter reach the POST', async () => {
    const seen = render('TEACHER', { search: '?type=GENERAL' });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/^Subject/), 'Leave of absence');
    await user.type(screen.getByLabelText(/^Application/), 'Please allow me.');
    await next(user);
    // Step 3: nothing chosen yet.
    await user.click(await screen.findByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Choose who the letter is addressed to')).toBeTruthy();
    await user.click(screen.getByRole('radio', { name: /A specific staff member/ }));
    await user.click(screen.getByRole('combobox', { name: 'A specific staff member' }));
    await user.click(await screen.findByRole('option', { name: 'Teacher Tina' }));
    await next(user);
    await next(user); // attachments, none
    expect(await screen.findByText('Dear Sir, the draft.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Submit application' }));
    await waitFor(() => expect(seen.create).toHaveLength(1));
    expect(seen.create[0]).toMatchObject({
      type: 'GENERAL',
      subject_staff_profile_id: 'sp-me',
      addressee: 'STAFF_USER',
      addressee_user_id: 'u-t',
      payload: { subject_line: 'Leave of absence', body: 'Please allow me.' },
    });
    expect(seen.create[0]).not.toHaveProperty('on_behalf_of_user_id');
    expect(seen.preview[0]).not.toHaveProperty('tags');
    await waitFor(() => expect(seen.router.state.location.pathname).toBe('/applications/app-1'));
  });

  it('paper TESTIMONIAL: guardian applicant sends on_behalf_of_user_id', async () => {
    const seen = render('OFFICE_STAFF', { search: '?type=TESTIMONIAL' });
    const user = userEvent.setup();
    await screen.findByText('Step 2 of 5');
    await user.type(screen.getByLabelText('Student'), 'Rahim');
    await user.click(await screen.findByRole('button', { name: /Rahim Uddin/ }));
    await user.click(await screen.findByRole('combobox', { name: 'Applicant' }));
    expect(screen.queryByRole('option', { name: /No Login/ })).toBeNull();
    await user.click(await screen.findByRole('option', { name: 'Karim Uddin (Father)' }));
    await user.type(await screen.findByLabelText(/^Purpose/), 'Scholarship');
    await next(user);
    await next(user); // addressee: fixed
    await next(user); // attachments
    await user.click(await screen.findByRole('button', { name: 'Submit application' }));
    await waitFor(() => expect(seen.create).toHaveLength(1));
    expect(seen.create[0]).toMatchObject({
      type: 'TESTIMONIAL',
      subject_student_id: STUDENT.id,
      on_behalf_of_user_id: 'u-g1',
      payload: { purpose: 'Scholarship' },
    });
  });

  it('"No login: type the name" sends applicant_name and blocks an empty name', async () => {
    const seen = render('OFFICE_STAFF', { search: `?type=TESTIMONIAL&student=${STUDENT.id}` });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('combobox', { name: 'Applicant' }));
    await user.click(await screen.findByRole('option', { name: 'No login: type the name' }));
    await user.type(await screen.findByLabelText(/^Purpose/), 'Scholarship');
    await next(user);
    expect(await screen.findByText("Enter the applicant's name")).toBeTruthy();
    expect(screen.getByText('Step 2 of 5')).toBeTruthy();
    await user.type(screen.getByLabelText("Applicant's name"), 'Neighbour Nasima');
    await next(user);
    await next(user);
    await next(user);
    await user.click(await screen.findByRole('button', { name: 'Submit application' }));
    await waitFor(() => expect(seen.create).toHaveLength(1));
    expect(seen.create[0]).toMatchObject({ applicant_name: 'Neighbour Nasima' });
    expect(seen.create[0]).not.toHaveProperty('on_behalf_of_user_id');
  });

  it('attachments: the 4th file and a 6 MB file are refused before any request', async () => {
    const seen = render('TEACHER', { search: '?type=ID_CARD_REPRINT' });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/^Reason/), 'Lost it');
    await next(user);
    await next(user);
    const input = await screen.findByLabelText('Attach files');
    const pdf = (name: string, size = 10) =>
      new File([new Uint8Array(size)], name, { type: 'application/pdf' });
    await user.upload(input, [pdf('a.pdf'), pdf('b.pdf'), pdf('c.pdf'), pdf('d.pdf')]);
    expect(await screen.findByText('At most 3 files')).toBeTruthy();
    await user.upload(input, pdf('big.pdf', 6 * 1024 * 1024));
    expect(await screen.findByText(/Files over 5 MB cannot be added: big\.pdf/)).toBeTruthy();
    expect(seen.create).toHaveLength(0);
    expect(seen.upload).toBe(0);
  });

  it('upload failure after create keeps the application and a retry does not create another', async () => {
    const seen = render('TEACHER', { search: '?type=ID_CARD_REPRINT', uploadFails: true });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/^Reason/), 'Lost it');
    await next(user);
    await next(user);
    await user.upload(
      await screen.findByLabelText('Attach files'),
      new File(['x'], 'a.pdf', { type: 'application/pdf' }),
    );
    await next(user);
    await user.click(await screen.findByRole('button', { name: 'Submit application' }));
    expect(
      await screen.findByText(
        /The application was submitted, but the files could not be attached\./,
      ),
    ).toBeTruthy();
    expect(screen.getByText(/Too many or too large files/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View the application' }).getAttribute('href')).toBe(
      '/applications/app-1',
    );
    await user.click(screen.getByRole('button', { name: 'Submit application' }));
    await waitFor(() => expect(seen.upload).toBe(2));
    expect(seen.create).toHaveLength(1);
  });

  it('Back keeps values, and Close with changes asks to discard', async () => {
    render('TEACHER', { search: '?type=ID_CARD_REPRINT' });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/^Reason/), 'Lost it');
    await next(user);
    await user.click(await screen.findByRole('button', { name: 'Back' }));
    expect(await screen.findByLabelText(/^Reason/)).toHaveProperty('value', 'Lost it');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Discard your changes?')).toBeTruthy();
  });

  it('Next moves focus to the new step heading', async () => {
    render('TEACHER', { search: '?type=ID_CARD_REPRINT' });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/^Reason/), 'Lost it');
    await next(user);
    const heading = await screen.findByRole('heading', { name: 'Addressee' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });
});
