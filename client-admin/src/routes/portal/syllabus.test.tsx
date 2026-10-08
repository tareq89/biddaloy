import { REGION_BD_EN } from '@biddaloy/ui/i18n';
import {
  cleanupTestState,
  classFactory,
  classSectionFactory,
  renderWithRouter,
  server,
  studentFactory,
} from '@biddaloy/ui/test';
import { formatDate } from '@biddaloy/ui/utils';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../routeTree.gen';

// Frozen clock (Date only) so "today" / "tomorrow" words and "exam is past"
// are deterministic.
vi.useFakeTimers({ toFake: ['Date'] });
afterAll(() => {
  vi.useRealTimers();
});
vi.setSystemTime(new Date('2026-05-12T05:00:00.000Z'));

const FATIMA_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const IMRAN_ID = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';

/**
 * [22.4.5] / [66.3] the portal syllabus tab, exercised through the real route
 * tree. Only family endpoints may be called: `/students/:id/study-plans` and
 * `/syllabus-topics` (class-scoped).
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
  }) {
    return {
      id: overrides.id,
      class_id: 'class-1',
      subject_id: overrides.subject_id,
      subject_name_en: overrides.subject_name_en,
      subject_name_bn: overrides.subject_name_en,
      name: overrides.name,
      description: null,
      sequence: overrides.sequence,
      status: overrides.status ?? 'PLANNED',
    };
  }

  const MATH = { id: 's-math', name_en: 'Mathematics', name_bn: 'গণিত' };
  const ENG = { id: 's-eng', name_en: 'English', name_bn: 'ইংরেজি' };
  const SCI = { id: 's-sci', name_en: 'Science', name_bn: 'বিজ্ঞান' };

  function subjectPlan(overrides: Record<string, unknown> = {}) {
    return {
      subject: MATH,
      plan_id: 'plan-math',
      teacher_names: ['Mr Karim', 'Ms Rina'],
      last_taught: { number: 18, title: 'Fractions', date: '2026-05-12' },
      next: [
        { number: 19, title: 'Decimals', expected_date: '2026-05-13' },
        { number: 20, title: 'Percent', expected_date: '2026-05-14' },
      ],
      expected_finish_date: '2026-07-01',
      periods_behind: 4,
      lessons_behind: 2,
      lessons_done: 18,
      lessons_total: 40,
      exam_syllabus: [],
      ...overrides,
    };
  }

  function plans(overrides: Record<string, unknown> = {}) {
    return {
      section: { id: 'sec-1', name: 'A', class_name: 'Class 8' },
      term: { id: 'term-1', name: 'Half-yearly term' },
      subjects: [subjectPlan()],
      subjects_without_plan: [],
      ...overrides,
    };
  }

  const syllabusRequests: { classId: string | null }[] = [];
  const planRequests: string[] = [];
  const otherRequests: string[] = [];

  function mockSyllabus(options: {
    students: unknown[];
    topicsByClass?: Record<string, unknown[]>;
    plansByStudent?: Record<string, unknown>;
    topicsError?: boolean;
    plansError?: boolean;
  }) {
    syllabusRequests.length = 0;
    planRequests.length = 0;
    otherRequests.length = 0;
    server.use(
      http.get('/api/v1/students/mine', () => HttpResponse.json(options.students)),
      http.get('/api/v1/syllabus-topics', ({ request }) => {
        const classId = new URL(request.url).searchParams.get('class_id');
        syllabusRequests.push({ classId });
        if (options.topicsError) {
          return HttpResponse.json({ message: 'boom' }, { status: 500 });
        }
        return HttpResponse.json((classId && options.topicsByClass?.[classId]) ?? []);
      }),
      http.get('/api/v1/students/:id/study-plans', ({ params }) => {
        planRequests.push(String(params.id));
        if (options.plansError) {
          return HttpResponse.json({ message: 'boom' }, { status: 500 });
        }
        return HttpResponse.json(options.plansByStudent?.[String(params.id)] ?? plans());
      }),
      // Staff endpoints must never be hit by a family page.
      http.get('/api/v1/study-plans', () => {
        otherRequests.push('/study-plans');
        return HttpResponse.json({}, { status: 403 });
      }),
      http.get('/api/v1/subjects', () => {
        otherRequests.push('/subjects');
        return HttpResponse.json({}, { status: 403 });
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

  const disclosure = (name: RegExp | string) => screen.findByRole('button', { name });

  it('renders the most-behind subject first and expanded, with the plain "why behind" sentence', async () => {
    mockSyllabus({
      students: [fatima],
      plansByStudent: {
        [FATIMA_ID]: plans({
          subjects: [
            subjectPlan({
              subject: ENG,
              plan_id: 'plan-eng',
              lessons_behind: 0,
              periods_behind: 0,
              last_taught: null,
              next: [],
            }),
            subjectPlan(),
          ],
        }),
      },
    });
    renderSyllabus();

    const mathButton = await disclosure(/Mathematics/);
    expect(mathButton.getAttribute('aria-expanded')).toBe('true');
    const buttons = screen.getAllByRole('button', { name: /Mathematics|English/ });
    expect(buttons.map((b) => b.textContent)).toEqual([
      expect.stringContaining('Mathematics'),
      expect.stringContaining('English'),
    ]);
    expect(within(mathButton).getByText('2 lesson behind')).toBeTruthy();
    expect(within(mathButton).getByText('Now: lesson 18 · Fractions')).toBeTruthy();
    expect(
      screen.getByText(
        'By the routine the class should be about 2 lessons further by now — 4 periods were not taught.',
      ),
    ).toBeTruthy();

    // The on-time subject: collapsed, "On time", no sentence of its own.
    const englishButton = screen.getByRole('button', { name: /English/ });
    expect(englishButton.getAttribute('aria-expanded')).toBe('false');
    expect(within(englishButton).getByText('On time')).toBeTruthy();
    expect(within(englishButton).getByText('Not started yet')).toBeTruthy();
    expect(screen.getAllByText(/should be about/)).toHaveLength(1);
  });

  it('lists the next lessons with their numbers and dates, the teacher and the finish date', async () => {
    mockSyllabus({ students: [fatima] });
    renderSyllabus();

    await disclosure(/Mathematics/);
    expect(screen.getByText('Teacher: Mr Karim, Ms Rina')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Next 5 lessons' })).toBeTruthy();
    const items = within(
      screen
        .getByRole('heading', { level: 3, name: 'Next 5 lessons' })
        .closest('section') as HTMLElement,
    ).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      `19Decimals · tomorrow, ${formatDate('2026-05-13', REGION_BD_EN)}`,
      `20Percent · ${formatDate('2026-05-14', REGION_BD_EN)}`,
    ]);
    expect(
      screen.getByText(
        `Whole plan expected to finish by ${formatDate('2026-07-01', REGION_BD_EN)}`,
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(`last taught today, ${formatDate('2026-05-12', REGION_BD_EN)}`, {
        exact: false,
      }),
    ).toBeTruthy();
    expect(screen.getByText(/Dates are estimates/)).toBeTruthy();
  });

  it('shows the soonest upcoming exam with taught/in-syllabus per subject, and none when past or absent', async () => {
    const exam = (
      id: string,
      name: string,
      date: string | null,
      inSyl: number,
      taught: number,
    ) => ({
      exam_id: id,
      exam_name: name,
      exam_date: date,
      lessons_in_syllabus: inSyl,
      lessons_taught: taught,
    });
    mockSyllabus({
      students: [fatima],
      plansByStudent: {
        [FATIMA_ID]: plans({
          subjects: [
            subjectPlan({
              exam_syllabus: [
                exam('e-past', 'Class test', '2026-05-01', 5, 5),
                exam('e-final', 'Final exam', '2026-11-01', 40, 18),
                exam('e-half', 'Half-yearly', '2026-06-14', 24, 18),
              ],
            }),
            subjectPlan({
              subject: ENG,
              plan_id: 'plan-eng',
              lessons_behind: 0,
              exam_syllabus: [exam('e-half', 'Half-yearly', '2026-06-14', 20, 20)],
            }),
          ],
        }),
      },
    });
    renderSyllabus();

    const card = (await screen.findByRole('heading', { level: 2, name: 'Half-yearly' })).closest(
      'section',
    ) as HTMLElement;
    expect(
      within(card).getByText(/From .* · how much of the syllabus is taught/).textContent,
    ).toContain(formatDate('2026-06-14', REGION_BD_EN));
    expect(within(card).getByText('Mathematics')).toBeTruthy();
    expect(within(card).getByText('18/24 lessons')).toBeTruthy();
    expect(within(card).getByText('English')).toBeTruthy();
    expect(within(card).getByText('20/20 lessons')).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 2, name: 'Class test' })).toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: 'Final exam' })).toBeNull();
  });

  it('shows no exam card when only past exams or none exist', async () => {
    mockSyllabus({
      students: [fatima],
      plansByStudent: {
        [FATIMA_ID]: plans({
          subjects: [
            subjectPlan({
              exam_syllabus: [
                {
                  exam_id: 'e-past',
                  exam_name: 'Class test',
                  exam_date: '2026-05-01',
                  lessons_in_syllabus: 5,
                  lessons_taught: 5,
                },
              ],
            }),
          ],
        }),
      },
    });
    renderSyllabus();

    await disclosure(/Mathematics/);
    expect(screen.queryByText('Class test')).toBeNull();
    expect(screen.queryByText(/how much of the syllabus is taught/)).toBeNull();
  });

  it('puts an exam with no date after dated ones and drops the date from its line', async () => {
    mockSyllabus({
      students: [fatima],
      plansByStudent: {
        [FATIMA_ID]: plans({
          subjects: [
            subjectPlan({
              exam_syllabus: [
                {
                  exam_id: 'e-x',
                  exam_name: 'Model test',
                  exam_date: null,
                  lessons_in_syllabus: 10,
                  lessons_taught: 4,
                },
              ],
            }),
          ],
        }),
      },
    });
    renderSyllabus();

    expect(await screen.findByRole('heading', { level: 2, name: 'Model test' })).toBeTruthy();
    expect(screen.getByText('How much of the syllabus is taught')).toBeTruthy();
  });

  it('says when the remaining exam lessons should finish, from the next list', async () => {
    mockSyllabus({
      students: [fatima],
      plansByStudent: {
        [FATIMA_ID]: plans({
          subjects: [
            subjectPlan({
              lessons_total: 20,
              next: [
                { number: 19, title: 'Decimals', expected_date: '2026-05-13' },
                { number: 20, title: 'Percent', expected_date: '2026-05-26' },
              ],
              exam_syllabus: [
                {
                  exam_id: 'e-half',
                  exam_name: 'Half-yearly',
                  exam_date: '2026-06-14',
                  lessons_in_syllabus: 20,
                  lessons_taught: 18,
                },
              ],
            }),
          ],
        }),
      },
    });
    renderSyllabus();

    expect(
      await screen.findByText(
        `The remaining 2 lessons should finish by ${formatDate('2026-05-26', REGION_BD_EN)}.`,
      ),
    ).toBeTruthy();
  });

  it('leaves the finish line out when the exam syllabus ends before the plan and past the next 5', async () => {
    mockSyllabus({
      students: [fatima],
      plansByStudent: {
        [FATIMA_ID]: plans({
          subjects: [
            subjectPlan({
              exam_syllabus: [
                {
                  exam_id: 'e-half',
                  exam_name: 'Half-yearly',
                  exam_date: '2026-06-14',
                  lessons_in_syllabus: 30,
                  lessons_taught: 18,
                },
              ],
            }),
          ],
        }),
      },
    });
    renderSyllabus();

    await disclosure(/Mathematics/);
    expect(screen.queryByText(/The remaining/)).toBeNull();
  });

  it('shows "No study plan" for a subject without a plan and its topic list when expanded', async () => {
    mockSyllabus({
      students: [fatima],
      plansByStudent: { [FATIMA_ID]: plans({ subjects_without_plan: [SCI] }) },
      topicsByClass: {
        [classA.id]: [
          topic({
            id: 't1',
            subject_id: 's-sci',
            subject_name_en: 'Science',
            name: 'Plants',
            sequence: 0,
            status: 'DONE',
          }),
          topic({
            id: 't2',
            subject_id: 's-sci',
            subject_name_en: 'Science',
            name: 'Light',
            sequence: 1,
          }),
        ],
      },
    });
    renderSyllabus();

    const sci = await disclosure(/Science/);
    expect(within(sci).getByText('No study plan')).toBeTruthy();
    expect(within(sci).getByText('Only the topic list · 1 of 2 done')).toBeTruthy();
    expect(screen.queryByText('Plants')).toBeNull();

    await userEvent.click(sci);
    expect(sci.getAttribute('aria-expanded')).toBe('true');
    const region = document.getElementById(sci.getAttribute('aria-controls') as string);
    const rows = within(region as HTMLElement).getAllByRole('listitem');
    expect(rows.map((li) => li.firstElementChild?.textContent)).toEqual(['1', '2']);
    expect(within(region as HTMLElement).getByText('Plants')).toBeTruthy();
    expect(within(region as HTMLElement).getByText('1 of 2 topics done')).toBeTruthy();
  });

  it('keeps a topic-only subject the plans response does not mention', async () => {
    mockSyllabus({
      students: [fatima],
      topicsByClass: {
        [classA.id]: [
          topic({
            id: 't1',
            subject_id: 's-art',
            subject_name_en: 'Art',
            name: 'Sketching',
            sequence: 0,
          }),
        ],
      },
    });
    renderSyllabus();

    expect(await disclosure(/Art/)).toBeTruthy();
  });

  it('shows the child and term in the subtitle and exactly one h1', async () => {
    mockSyllabus({ students: [fatima] });
    renderSyllabus();

    expect(await screen.findByText(/^Fatima Rahman · .* · Half-yearly term$/)).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual([
      'Syllabus',
    ]);
  });

  it('requests study plans for the selected child, refetches on switching, and never without an id', async () => {
    mockSyllabus({
      students: [fatima, imran],
      plansByStudent: {
        [IMRAN_ID]: plans({ subjects: [subjectPlan({ subject: ENG, plan_id: 'plan-eng' })] }),
      },
    });
    renderSyllabus();

    await waitFor(() => expect(planRequests).toContain(FATIMA_ID));
    await waitFor(() => expect(syllabusRequests.map((r) => r.classId)).toContain(classA.id));

    const picker = await screen.findByRole('navigation', { name: 'Choose a student' });
    await userEvent.click(within(picker).getByRole('link', { name: /Imran Rahman/ }));

    await waitFor(() => expect(planRequests).toContain(IMRAN_ID));
    await waitFor(() => expect(syllabusRequests.map((r) => r.classId)).toContain(classB.id));
    expect(await disclosure(/English/)).toBeTruthy();
    expect(planRequests.every((id) => id.length > 0 && id !== 'undefined')).toBe(true);
  });

  it('shows a no-class message and makes no plans or topics request when the child has no class', async () => {
    mockSyllabus({ students: [child('No Class Kid', FATIMA_ID, 3, null)] });
    renderSyllabus();

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Not in a class yet' }),
    ).toBeTruthy();
    expect(syllabusRequests).toHaveLength(0);
    expect(planRequests).toHaveLength(0);
  });

  it('shows an empty message when the class has no plans and no topics', async () => {
    mockSyllabus({
      students: [fatima],
      plansByStudent: { [FATIMA_ID]: plans({ subjects: [] }) },
    });
    renderSyllabus();

    expect(await screen.findByRole('heading', { level: 2, name: 'No syllabus yet' })).toBeTruthy();
  });

  it('shows the existing error state with Retry when the study-plans call fails, no half page', async () => {
    mockSyllabus({ students: [fatima], plansError: true });
    renderSyllabus();

    expect(await screen.findByText(/Couldn't load the syllabus/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Mathematics/ })).toBeNull();
    const before = planRequests.length;

    await userEvent.click(screen.getByRole('button', { name: /Try again/ }));
    await waitFor(() => expect(planRequests.length).toBeGreaterThan(before));
  });

  it('shows the error state when the topics call fails', async () => {
    mockSyllabus({ students: [fatima], topicsError: true });
    renderSyllabus();

    expect(await screen.findByText(/Couldn't load the syllabus/)).toBeTruthy();
  });

  it('calls no staff endpoint', async () => {
    mockSyllabus({ students: [fatima] });
    renderSyllabus();

    await disclosure(/Mathematics/);
    expect(otherRequests).toEqual([]);
  });

  it('renders numbers and dates through the Bangla formatters', async () => {
    mockSyllabus({ students: [fatima] });
    renderSyllabus('/portal/syllabus', 'bn');

    await disclosure(/গণিত/);
    // 18 -> ১৮, 19 -> ১৯ (no Latin digits in the lesson numbers).
    expect(screen.getAllByText(/১৮/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/১৯/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/^19/)).toBeNull();
  });

  it('has no write controls', async () => {
    mockSyllabus({ students: [fatima] });
    renderSyllabus();

    await disclosure(/Mathematics/);
    expect(screen.queryByRole('button', { name: /add|edit|delete|move/i })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('is axe clean', async () => {
    mockSyllabus({
      students: [fatima],
      plansByStudent: { [FATIMA_ID]: plans({ subjects_without_plan: [SCI] }) },
    });
    const { container } = renderSyllabus();

    await disclosure(/Mathematics/);
    await expect(container).toHaveNoViolations();
  });
});
