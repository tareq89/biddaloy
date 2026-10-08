import { SyllabusTopicStatus } from '@biddaloy/shared';
import { REGION_BD_BN } from '@biddaloy/ui/i18n';
import {
  classFactory,
  cleanupTestState,
  renderWithRouter,
  server,
  subjectFactory,
} from '@biddaloy/ui/test';
import { formatNumber } from '@biddaloy/ui/utils';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

const notifyOutcome = vi.hoisted(() => vi.fn());
vi.mock('@biddaloy/ui/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@biddaloy/ui/api')>()),
  notifyOutcome,
}));

const klass = classFactory({ id: 'class-1', name: 'Class 6' });
const subject = subjectFactory({ id: 'subject-1', name_en: 'Mathematics', name_bn: 'গণিত' });

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
  await user.click(await screen.findByRole('combobox', { name: 'Class' }));
  await user.click(await screen.findByRole('option', { name: 'Class 6' }));
  await user.click(screen.getByRole('combobox', { name: 'Subject' }));
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

    const pickTitle = await screen.findByText('Pick a class and a subject');
    expect(pickTitle.tagName).toBe('H2');
    expect(screen.getByText('Pick a class and subject to see its syllabus.')).toBeTruthy();

    const user = userEvent.setup();
    await pickClassAndSubject(user);

    await screen.findByText('Algebra basics');
    const rows = screen.getAllByRole('row').slice(1); // drop header row
    expect(within(rows[0]!).getByText('Algebra basics')).toBeTruthy();
    expect(within(rows[1]!).getByText('Geometry')).toBeTruthy();
    // Numbered in teaching order (region digits).
    expect(within(rows[0]!).getByText(formatNumber(1, REGION_BD_BN))).toBeTruthy();
    expect(within(rows[1]!).getByText(formatNumber(2, REGION_BD_BN))).toBeTruthy();
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

    const title = await screen.findByText('No topics yet');
    expect(title.tagName).toBe('H2');
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

    await user.click(screen.getByRole('button', { name: 'Edit Algebra basics' }));
    await user.click(screen.getByRole('combobox', { name: 'Status' }));
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

    await user.click(screen.getByRole('button', { name: 'Delete Algebra basics' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleted).toBe(true));
  });

  it('counts DONE topics in the progress line', async () => {
    server.use(
      ...classesAndSubjectsHandlers(),
      http.get('/api/v1/syllabus-topics', () =>
        HttpResponse.json([
          topic({ id: 'topic-1', name: 'Algebra basics', sequence: 0, status: 'DONE' }),
          topic({ id: 'topic-2', name: 'Geometry', sequence: 1 }),
        ]),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/academics/syllabus'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await pickClassAndSubject(user);

    const done = formatNumber(1, REGION_BD_BN);
    const total = formatNumber(2, REGION_BD_BN);
    expect(await screen.findByText(`${done} of ${total} topics done`)).toBeTruthy();
  });

  it('a failed reorder raises an error notification', async () => {
    server.use(
      ...classesAndSubjectsHandlers(),
      http.get('/api/v1/syllabus-topics', () =>
        HttpResponse.json([
          topic({ id: 'topic-1', name: 'Algebra basics', sequence: 0 }),
          topic({ id: 'topic-2', name: 'Geometry', sequence: 1 }),
        ]),
      ),
      http.patch('/api/v1/syllabus-topics/reorder', () =>
        HttpResponse.json({ message: 'boom' }, { status: 500 }),
      ),
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
      expect(notifyOutcome).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error' })),
    );
  });

  it('restores the pick from the URL on load', async () => {
    server.use(
      ...classesAndSubjectsHandlers(),
      http.get('/api/v1/syllabus-topics', () => HttpResponse.json([topic()])),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/academics/syllabus?class_id=class-1&subject_id=subject-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    expect(await screen.findByText('Algebra basics')).toBeTruthy();
  });

  it('ignores a class_id in the URL that is not a known class', async () => {
    let listed = false;
    server.use(
      ...classesAndSubjectsHandlers(),
      http.get('/api/v1/syllabus-topics', () => {
        listed = true;
        return HttpResponse.json([]);
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/academics/syllabus?class_id=nope&subject_id=subject-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    expect(await screen.findByText('Pick a class and a subject')).toBeTruthy();
    expect(listed).toBe(false);
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

  it('a failed delete raises an error notification', async () => {
    server.use(
      ...classesAndSubjectsHandlers(),
      http.get('/api/v1/syllabus-topics', () => HttpResponse.json([topic()])),
      http.delete('/api/v1/syllabus-topics/topic-1', () =>
        HttpResponse.json({ message: 'boom' }, { status: 500 }),
      ),
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
    await user.click(screen.getByRole('button', { name: 'Delete Algebra basics' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(notifyOutcome).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error' })),
    );
  });

  it('phone layout renders labelled buttons and no table', async () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- restored as-is below
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes('max-width'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    try {
      server.use(
        ...classesAndSubjectsHandlers(),
        http.get('/api/v1/syllabus-topics', () => HttpResponse.json([topic()])),
      );
      renderWithRouter(routeTree, {
        initialEntries: ['/academics/syllabus?class_id=class-1&subject_id=subject-1'],
        tenantId: 'tenant-1',
        role: 'ADMIN',
        locale: 'en',
      });
      await screen.findByText('Algebra basics');
      expect(screen.getByRole('button', { name: 'Edit Algebra basics' })).toBeTruthy();
      expect(screen.queryByRole('table')).toBeNull();
    } finally {
      window.matchMedia = original;
    }
  });

  describe('tabs', () => {
    function plansHandlers() {
      return [
        http.get('/api/v1/academic-years', () =>
          HttpResponse.json({ data: [], total: 0, page: 1, limit: 25, totalPages: 0 }),
        ),
        http.get('/api/v1/calendar/terms', () => HttpResponse.json([])),
        http.get('/api/v1/schools/:id/settings', () => HttpResponse.json({ version: 1 })),
        http.get('/api/v1/study-plans', () =>
          HttpResponse.json({ data: [], total: 0, page: 1, limit: 25, totalPages: 0 }),
        ),
      ];
    }

    it('defaults to Topics, clicking Study plans sets ?tab=plans and back drops it', async () => {
      server.use(...classesAndSubjectsHandlers(), ...plansHandlers());
      const { router } = renderWithRouter(routeTree, {
        initialEntries: ['/academics/syllabus'],
        tenantId: 'tenant-1',
        role: 'ADMIN',
        locale: 'en',
      });
      const user = userEvent.setup();
      const topics = await screen.findByRole('tab', { name: 'Topics' });
      expect(topics.getAttribute('aria-selected')).toBe('true');
      expect(await screen.findByRole('combobox', { name: 'Class' })).toBeTruthy();

      await user.click(screen.getByRole('tab', { name: 'Study plans' }));
      await waitFor(() => expect(router.state.location.search).toMatchObject({ tab: 'plans' }));
      expect(await screen.findByText('No study plans yet')).toBeTruthy();

      await user.click(screen.getByRole('tab', { name: 'Topics' }));
      await waitFor(() => expect(router.state.location.search).not.toHaveProperty('tab'));
    });

    it('the Topics tab makes no study-plan request', async () => {
      let planRequests = 0;
      server.use(
        ...classesAndSubjectsHandlers(),
        ...plansHandlers(),
        http.get('/api/v1/study-plans', () => {
          planRequests += 1;
          return HttpResponse.json({ data: [], total: 0, page: 1, limit: 25, totalPages: 0 });
        }),
      );
      renderWithRouter(routeTree, {
        initialEntries: ['/academics/syllabus'],
        tenantId: 'tenant-1',
        role: 'ADMIN',
        locale: 'en',
      });
      await screen.findByRole('combobox', { name: 'Class' });
      await new Promise((r) => setTimeout(r, 100));
      expect(planRequests).toBe(0);
    });

    it('?tab=plans on load shows the plans panel', async () => {
      server.use(...classesAndSubjectsHandlers(), ...plansHandlers());
      renderWithRouter(routeTree, {
        initialEntries: ['/academics/syllabus?tab=plans'],
        tenantId: 'tenant-1',
        role: 'ADMIN',
        locale: 'en',
      });
      expect(await screen.findByText('No study plans yet')).toBeTruthy();
      expect(
        (await screen.findByRole('tab', { name: 'Study plans' })).getAttribute('aria-selected'),
      ).toBe('true');
    });

    it('arrow keys move between tabs', async () => {
      server.use(...classesAndSubjectsHandlers(), ...plansHandlers());
      renderWithRouter(routeTree, {
        initialEntries: ['/academics/syllabus'],
        tenantId: 'tenant-1',
        role: 'ADMIN',
        locale: 'en',
      });
      const user = userEvent.setup();
      (await screen.findByRole('tab', { name: 'Topics' })).focus();
      await user.keyboard('{ArrowRight}');
      expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Study plans' }));
    });
  });

  it('shows "Taught in x of y sections" under a topic when the API returns the counts', async () => {
    server.use(
      ...classesAndSubjectsHandlers(),
      http.get('/api/v1/syllabus-topics', () =>
        HttpResponse.json([
          topic({ sections_planned: 3, sections_taught: 2 }),
          topic({
            id: 'topic-2',
            name: 'Geometry',
            sequence: 1,
            sections_planned: 0,
            sections_taught: 0,
          }),
        ]),
      ),
    );
    renderWithRouter(routeTree, {
      initialEntries: ['/academics/syllabus?class_id=class-1&subject_id=subject-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    expect(
      await screen.findByText(
        `Taught in ${formatNumber(2, REGION_BD_BN)} of ${formatNumber(3, REGION_BD_BN)} sections`,
      ),
    ).toBeTruthy();
    expect(screen.getAllByText(/Taught in/)).toHaveLength(1);
  });
});
