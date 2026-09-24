import { SyllabusTopicStatus } from '@biddaloy/shared';
import {
  classFactory,
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

const klass = classFactory({ id: 'class-1', name: 'Class 6' });
const subject = subjectFactory({ id: 'subject-1', name_en: 'Mathematics' });

function classesAndSubjectsHandlers() {
  return [
    http.get('/api/v1/classes', () =>
      HttpResponse.json({ data: [klass], total: 1, page: 1, limit: 100, totalPages: 1 }),
    ),
    http.get('/api/v1/subjects', () =>
      HttpResponse.json({ data: [subject], total: 1, page: 1, limit: 100, totalPages: 1 }),
    ),
  ];
}

async function pickClassAndSubject(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByLabelText('Class'));
  await user.click(await screen.findByRole('option', { name: 'Class 6' }));
  await user.click(screen.getByLabelText('Subject'));
  await user.click(await screen.findByRole('option', { name: 'Mathematics' }));
}

function topic(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'topic-1',
    class_id: klass.id,
    subject_id: subject.id,
    name: 'Algebra basics',
    description: null,
    sequence: 0,
    status: SyllabusTopicStatus.PLANNED,
    ...overrides,
  };
}

describe('/academics/syllabus', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows a message before a class/subject is picked, then lists topics in sequence order', async () => {
    server.use(
      ...classesAndSubjectsHandlers(),
      http.get('/api/v1/syllabus-topics', () =>
        HttpResponse.json([
          topic({ id: 'topic-2', name: 'Geometry', sequence: 1 }),
          topic({ id: 'topic-1', name: 'Algebra basics', sequence: 0 }),
        ]),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/academics/syllabus'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    expect(await screen.findByText('Pick a class and subject to see its syllabus.')).toBeTruthy();

    const user = userEvent.setup();
    await pickClassAndSubject(user);

    await screen.findByText('Algebra basics');
    const rows = screen.getAllByRole('row').slice(1); // drop header row
    expect(within(rows[0]!).getByText('Algebra basics')).toBeTruthy();
    expect(within(rows[1]!).getByText('Geometry')).toBeTruthy();
  });

  it('empty list renders the empty message', async () => {
    server.use(
      ...classesAndSubjectsHandlers(),
      http.get('/api/v1/syllabus-topics', () => HttpResponse.json([])),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/academics/syllabus'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await pickClassAndSubject(user);

    expect(await screen.findByText('No syllabus topics yet.')).toBeTruthy();
  });

  it("moving a topic down sends both rows' swapped sequence to the reorder endpoint", async () => {
    let reorderBody: unknown;
    server.use(
      ...classesAndSubjectsHandlers(),
      http.get('/api/v1/syllabus-topics', () =>
        HttpResponse.json([
          topic({ id: 'topic-1', name: 'Algebra basics', sequence: 0 }),
          topic({ id: 'topic-2', name: 'Geometry', sequence: 1 }),
        ]),
      ),
      http.patch('/api/v1/syllabus-topics/reorder', async ({ request }) => {
        reorderBody = await request.json();
        return HttpResponse.json([]);
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/academics/syllabus'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await pickClassAndSubject(user);
    await screen.findByText('Algebra basics');

    await user.click(screen.getByLabelText('Move Algebra basics down'));

    await waitFor(() =>
      expect(reorderBody).toEqual({
        items: [
          { id: 'topic-1', sequence: 1 },
          { id: 'topic-2', sequence: 0 },
        ],
      }),
    );
  });

  it('changing status in the edit dialog PATCHes the topic', async () => {
    let updateBody: unknown;
    server.use(
      ...classesAndSubjectsHandlers(),
      http.get('/api/v1/syllabus-topics', () => HttpResponse.json([topic()])),
      http.patch('/api/v1/syllabus-topics/topic-1', async ({ request }) => {
        updateBody = await request.json();
        return HttpResponse.json(topic({ status: SyllabusTopicStatus.DONE }));
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/academics/syllabus'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await pickClassAndSubject(user);
    await screen.findByText('Algebra basics');

    await user.click(screen.getByText('Edit Algebra basics'));
    await user.click(screen.getByLabelText('Status'));
    await user.click(await screen.findByRole('option', { name: 'Done' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(updateBody).toEqual({
        name: 'Algebra basics',
        description: null,
        status: SyllabusTopicStatus.DONE,
      }),
    );
  });

  it('confirming delete calls the delete endpoint', async () => {
    let deleted = false;
    server.use(
      ...classesAndSubjectsHandlers(),
      http.get('/api/v1/syllabus-topics', () => HttpResponse.json([topic()])),
      http.delete('/api/v1/syllabus-topics/topic-1', () => {
        deleted = true;
        return HttpResponse.json({ deleted: true });
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/academics/syllabus'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await pickClassAndSubject(user);
    await screen.findByText('Algebra basics');

    await user.click(screen.getByText('Delete Algebra basics'));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleted).toBe(true));
  });

  it('refuses the whole route for a role lacking SYLLABUS_READ', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/academics/syllabus'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    expect(await screen.findByText("You don't have access to this page.")).toBeTruthy();
  });
});
