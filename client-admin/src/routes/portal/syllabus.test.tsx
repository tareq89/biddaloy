import {
  cleanupTestState,
  classFactory,
  classSectionFactory,
  renderWithRouter,
  server,
  studentFactory,
} from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../routeTree.gen';

const FATIMA_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const IMRAN_ID = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';

/**
 * [22.4.5]'s portal syllabus tab, exercised through the real route
 * tree — same reasoning `attendance.test.tsx` documents for itself.
 */
describe('/portal/syllabus', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  function child(
    name: string,
    id: string,
    roll: number,
    classSection: ReturnType<typeof classSectionFactory> | null,
  ) {
    return studentFactory({
      id,
      full_name: name,
      roll_number: roll,
      // `class_section` is typed non-nullable in the generated schema, but
      // the server can (and this test does) send a student with none —
      // same defensive `?.` chain `attendance.tsx` relies on.
      class_section: classSection as unknown as ReturnType<typeof classSectionFactory>,
    });
  }

  function topic(overrides: {
    id: string;
    subject_id: string;
    subject_name_en: string | null;
    name: string;
    sequence: number;
    status?: string;
    description?: string | null;
  }) {
    return {
      id: overrides.id,
      class_id: 'class-1',
      subject_id: overrides.subject_id,
      subject_name_en: overrides.subject_name_en,
      subject_name_bn: overrides.subject_name_en,
      name: overrides.name,
      description: overrides.description ?? null,
      sequence: overrides.sequence,
      status: overrides.status ?? 'PLANNED',
    };
  }

  const syllabusRequests: { classId: string | null }[] = [];

  function mockSyllabus(options: {
    students: unknown[];
    topicsByClass: Record<string, unknown[]>;
    error?: boolean;
  }) {
    syllabusRequests.length = 0;
    server.use(
      http.get('/api/v1/students/mine', () => HttpResponse.json(options.students)),
      http.get('/api/v1/syllabus-topics', ({ request }) => {
        const classId = new URL(request.url).searchParams.get('class_id');
        syllabusRequests.push({ classId });
        if (options.error) {
          return HttpResponse.json({ message: 'boom' }, { status: 500 });
        }
        return HttpResponse.json((classId && options.topicsByClass[classId]) ?? []);
      }),
    );
  }

  function renderSyllabus(path = '/portal/syllabus', locale = 'en') {
    return renderWithRouter(routeTree, {
      initialEntries: [path],
      tenantId: 'tenant-1',
      role: 'PARENT',
      locale,
    });
  }

  const classA = classFactory({ id: 'class-a', name: 'Class 8' });
  const classB = classFactory({ id: 'class-b', name: 'Class 3' });
  const fatima = child('Fatima Rahman', FATIMA_ID, 14, classSectionFactory({ class: classA }));
  const imran = child('Imran Rahman', IMRAN_ID, 7, classSectionFactory({ class: classB }));

  it('groups topics under subject headings, sorted, preserving within-subject order', async () => {
    mockSyllabus({
      students: [fatima],
      topicsByClass: {
        [classA.id]: [
          topic({
            id: 't1',
            subject_id: 's-math',
            subject_name_en: 'Mathematics',
            name: 'Algebra',
            sequence: 0,
          }),
          topic({
            id: 't2',
            subject_id: 's-math',
            subject_name_en: 'Mathematics',
            name: 'Geometry',
            sequence: 1,
          }),
          topic({
            id: 't3',
            subject_id: 's-eng',
            subject_name_en: 'English',
            name: 'Grammar',
            sequence: 0,
          }),
        ],
      },
    });
    renderSyllabus();

    const headings = await screen.findAllByRole('heading', { level: 2 });
    expect(headings.map((h) => h.textContent)).toEqual(['English', 'Mathematics']);

    const mathHeading = headings[1];
    expect(mathHeading).toBeTruthy();
    const mathCard = mathHeading?.closest('div');
    expect(mathCard).toBeTruthy();
    const items = within(mathCard as HTMLElement).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining('Algebra'),
      expect.stringContaining('Geometry'),
    ]);
  });

  it('requests the selected child class_id', async () => {
    mockSyllabus({ students: [fatima], topicsByClass: { [classA.id]: [] } });
    renderSyllabus();

    await waitFor(() => expect(syllabusRequests).toContainEqual({ classId: classA.id }));
  });

  it('switches class when picking the second child', async () => {
    mockSyllabus({
      students: [fatima, imran],
      topicsByClass: { [classA.id]: [], [classB.id]: [] },
    });
    renderSyllabus();

    await waitFor(() => expect(syllabusRequests.map((r) => r.classId)).toContain(classA.id));

    const picker = await screen.findByRole('navigation', { name: 'Choose a student' });
    await userEvent.click(within(picker).getByRole('link', { name: /Imran Rahman/ }));

    await waitFor(() => expect(syllabusRequests.map((r) => r.classId)).toContain(classB.id));
  });

  it('shows a no-class message and makes no topics request when the child has no class', async () => {
    mockSyllabus({ students: [child('No Class Kid', FATIMA_ID, 3, null)], topicsByClass: {} });
    renderSyllabus();

    expect(await screen.findByText(/isn't assigned to a class yet/)).toBeTruthy();
    expect(syllabusRequests).toHaveLength(0);
  });

  it('shows an empty message when the class has no topics', async () => {
    mockSyllabus({ students: [fatima], topicsByClass: { [classA.id]: [] } });
    renderSyllabus();

    expect(
      await screen.findByText('No syllabus topics have been added for this class yet.'),
    ).toBeTruthy();
  });

  it('shows a retryable error and refetches on retry', async () => {
    mockSyllabus({ students: [fatima], topicsByClass: {}, error: true });
    renderSyllabus();

    expect(await screen.findByText(/Couldn't load the syllabus/)).toBeTruthy();
    const retryCount = syllabusRequests.length;

    await userEvent.click(screen.getByRole('button', { name: /Try again/ }));
    await waitFor(() => expect(syllabusRequests.length).toBeGreaterThan(retryCount));
  });

  it('has no write controls', async () => {
    mockSyllabus({
      students: [fatima],
      topicsByClass: {
        [classA.id]: [
          topic({
            id: 't1',
            subject_id: 's-math',
            subject_name_en: 'Mathematics',
            name: 'Algebra',
            sequence: 0,
          }),
        ],
      },
    });
    renderSyllabus();

    await screen.findByText('Algebra');
    expect(screen.queryByRole('button', { name: /add|edit|delete|move/i })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('keeps the mobile bottom bar within 5 cells and shows Syllabus in the sidebar', async () => {
    mockSyllabus({ students: [fatima], topicsByClass: { [classA.id]: [] } });
    renderSyllabus();

    await screen.findByRole('heading', { level: 1, name: 'Syllabus' });
    const bottomNav = screen.getByRole('navigation', { name: 'Portal' });
    const cells = [
      ...within(bottomNav).queryAllByRole('link'),
      ...within(bottomNav).queryAllByRole('button'),
    ];
    expect(cells.length).toBeLessThanOrEqual(5);

    const sidebar = screen.getByRole('navigation', { name: 'Main' });
    expect(within(sidebar).getAllByRole('link')).toHaveLength(9);
    expect(within(sidebar).getByRole('link', { name: 'Syllabus' })).toBeTruthy();
  });
});
