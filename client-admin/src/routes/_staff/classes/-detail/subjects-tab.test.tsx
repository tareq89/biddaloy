import {
  classFactory,
  classSubjectFactory,
  cleanupTestState,
  renderWithRouter,
  server,
  subjectFactory,
} from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

/**
 * [9.1] Class detail page's Subjects tab — deep-linked via
 * `?tab=subjects`, same pattern `$classId.test.tsx`'s own tabs use.
 * Covers empty, populated, add, and remove.
 */
describe('classes/$classId Subjects tab', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows an empty message when the class offers no subjects', async () => {
    const klass = classFactory({ id: 'class-1' });
    server.use(
      http.get('/api/v1/classes/:id', () => HttpResponse.json(klass)),
      http.get('/api/v1/classes/:classId/subjects', () => HttpResponse.json([])),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/classes/class-1?tab=subjects'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('No subjects offered yet');
  });

  it('lists the subjects a class offers', async () => {
    const klass = classFactory({ id: 'class-1' });
    const subject = subjectFactory({ name_en: 'Mathematics', code: 'MATH' });
    const classSubject = classSubjectFactory({
      class: klass,
      class_id: klass.id,
      subject,
      subject_id: subject.id,
      academic_year: klass.academic_year,
      academic_year_id: klass.academic_year.id,
      is_optional: false,
    });
    server.use(
      http.get('/api/v1/classes/:id', () => HttpResponse.json(klass)),
      http.get('/api/v1/classes/:classId/subjects', () => HttpResponse.json([classSubject])),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/classes/class-1?tab=subjects'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('Mathematics');
    expect(screen.getByText('MATH')).toBeTruthy();
    expect(screen.getByText('No')).toBeTruthy();
  });

  it('attaches a subject through the Add subject dialog', async () => {
    const klass = classFactory({ id: 'class-1' });
    const subject = subjectFactory({ id: 'subject-1', name_en: 'Bangla', code: 'BAN' });
    let attached = false;

    server.use(
      http.get('/api/v1/classes/:id', () => HttpResponse.json(klass)),
      http.get('/api/v1/classes/:classId/subjects', () =>
        HttpResponse.json(
          attached
            ? [
                classSubjectFactory({
                  class: klass,
                  class_id: klass.id,
                  subject,
                  subject_id: subject.id,
                  academic_year: klass.academic_year,
                  academic_year_id: klass.academic_year.id,
                }),
              ]
            : [],
        ),
      ),
      http.get('/api/v1/subjects', () =>
        HttpResponse.json({ data: [subject], total: 1, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.post('/api/v1/classes/:classId/subjects', () => {
        attached = true;
        return HttpResponse.json(
          classSubjectFactory({
            class: klass,
            class_id: klass.id,
            subject,
            subject_id: subject.id,
            academic_year: klass.academic_year,
            academic_year_id: klass.academic_year.id,
          }),
          { status: 201 },
        );
      }),
    );

    const user = userEvent.setup();
    renderWithRouter(routeTree, {
      initialEntries: ['/classes/class-1?tab=subjects'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('No subjects offered yet');
    await user.click(screen.getByRole('button', { name: '+ Subject' }));

    const dialog = await screen.findByRole('dialog', { name: 'Add subject' });
    const picker = within(dialog).getByRole('combobox', { name: 'Subject' });
    await user.click(picker);
    await user.type(picker, 'Bangla');
    await user.click(await screen.findByRole('option', { name: 'Bangla (BAN)' }));
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await screen.findByText('Bangla');
  });

  it('removes a subject through the Remove dialog', async () => {
    const klass = classFactory({ id: 'class-1' });
    const subject = subjectFactory({ id: 'subject-1', name_en: 'Mathematics', code: 'MATH' });
    let removed = false;

    server.use(
      http.get('/api/v1/classes/:id', () => HttpResponse.json(klass)),
      http.get('/api/v1/classes/:classId/subjects', () =>
        HttpResponse.json(
          removed
            ? []
            : [
                classSubjectFactory({
                  class: klass,
                  class_id: klass.id,
                  subject,
                  subject_id: subject.id,
                  academic_year: klass.academic_year,
                  academic_year_id: klass.academic_year.id,
                }),
              ],
        ),
      ),
      http.delete('/api/v1/classes/:classId/subjects/:subjectId', () => {
        removed = true;
        return new HttpResponse(null, { status: 200 });
      }),
    );

    const user = userEvent.setup();
    renderWithRouter(routeTree, {
      initialEntries: ['/classes/class-1?tab=subjects'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('Mathematics');
    await user.click(screen.getByRole('button', { name: 'Remove' }));

    const dialog = await screen.findByRole('dialog', { name: 'Remove subject' });
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await screen.findByText('No subjects offered yet');
  });
});
