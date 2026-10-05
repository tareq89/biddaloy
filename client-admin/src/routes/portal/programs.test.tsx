import { REGION_BD_EN } from '@biddaloy/ui/i18n';
import {
  apiErrorBody,
  classFactory,
  classSectionFactory,
  renderWithRouter,
  server,
  studentFactory,
} from '@biddaloy/ui/test';
import { formatDate } from '@biddaloy/ui/utils';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../routeTree.gen';

import { visibleMilestones } from './programs';

/**
 * [34.5.2] Portal programs — read-only tick list of a child's program
 * milestones, exercised through the real route tree same as
 * `portal/results.test.tsx` documents for itself.
 */
describe('/portal/programs', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function child(name: string, id: string, className: string, section: string, roll: number) {
    return studentFactory({
      id,
      full_name: name,
      roll_number: roll,
      class_section: classSectionFactory({
        section_name: section,
        class: classFactory({ name: className }),
      }),
    });
  }

  const fatima = child('Fatima Rahman', 'student-1', 'Class 8', 'B', 14);
  const imran = child('Imran Rahman', 'student-2', 'Class 3', 'A', 7);

  function entry(
    programId: string,
    programName: string,
    status: string,
    milestones: { id: string; name: string; achieved: boolean }[],
    enrollmentId = `enrollment-${programId}`,
  ) {
    return {
      program: { id: programId, name: programName },
      enrollment: { id: enrollmentId, status },
      milestones: milestones.map((m) => ({
        id: m.id,
        name: m.name,
        achievement: m.achieved ? { achieved_on: '2026-01-10', score: null, grade: null } : null,
      })),
      achieved_count: milestones.filter((m) => m.achieved).length,
      milestone_total: milestones.length,
    };
  }

  function mockPrograms(options: { students: unknown[]; programs: Record<string, unknown[]> }) {
    server.use(
      http.get('/api/v1/students/mine', () => HttpResponse.json(options.students)),
      http.get('/api/v1/students/:studentId/programs', ({ params }) => {
        const id = params.studentId as string;
        return HttpResponse.json(options.programs[id] ?? []);
      }),
    );
  }

  function renderPrograms(path = '/portal/programs', locale = 'en') {
    return renderWithRouter(routeTree, {
      initialEntries: [path],
      tenantId: 'tenant-1',
      role: 'PARENT',
      locale,
    });
  }

  it('renders a program with its milestone tick list', async () => {
    mockPrograms({
      students: [fatima],
      programs: {
        'student-1': [
          entry('program-1', 'Hifz Program', 'ACTIVE', [
            { id: 'm-1', name: 'Juz 1', achieved: true },
            { id: 'm-2', name: 'Juz 2', achieved: false },
          ]),
        ],
      },
    });
    renderPrograms();

    expect(await screen.findByText('Hifz Program')).toBeTruthy();
    expect(screen.getByText('Juz 1')).toBeTruthy();
    expect(screen.getByText('Juz 2')).toBeTruthy();
  });

  it('shows the status as a translated badge and the progress as a sentence', async () => {
    mockPrograms({
      students: [fatima],
      programs: {
        'student-1': [
          entry('program-1', 'Hifz Program', 'ACTIVE', [
            { id: 'm-1', name: 'Juz 1', achieved: true },
            { id: 'm-2', name: 'Juz 2', achieved: false },
          ]),
        ],
      },
    });
    renderPrograms();

    const card = (await screen.findByRole('heading', { level: 2, name: 'Hifz Program' })).closest(
      'article',
    ) as HTMLElement;
    expect(within(card).getByText('Active').getAttribute('data-slot')).toBe('status-badge');
    expect(within(card).getByText('1 of 2 milestones achieved')).toBeTruthy();
  });

  it('shows an achieved date in long form and marks the next milestone', async () => {
    mockPrograms({
      students: [fatima],
      programs: {
        'student-1': [
          entry('program-1', 'Hifz Program', 'ACTIVE', [
            { id: 'm-1', name: 'Juz 1', achieved: true },
            { id: 'm-2', name: 'Juz 2', achieved: false },
            { id: 'm-3', name: 'Juz 3', achieved: false },
          ]),
        ],
      },
    });
    renderPrograms();

    const achieved = (await screen.findByText('Juz 1')).closest('li') as HTMLElement;
    expect(within(achieved).getByText(formatDate('2026-01-10', REGION_BD_EN))).toBeTruthy();
    expect(screen.queryByText(/2026-01-10/)).toBeNull();
    const next = screen.getByText('Juz 2').closest('li') as HTMLElement;
    expect(within(next).getByText('Next')).toBeTruthy();
    const later = screen.getByText('Juz 3').closest('li') as HTMLElement;
    expect(within(later).queryByText('Next')).toBeNull();
  });

  it('shows only a short list for a long program until "Show all" is pressed', async () => {
    const thirty = Array.from({ length: 30 }, (_, i) => ({
      id: `m-${i + 1}`,
      name: `Juz ${i + 1}`,
      achieved: i < 4,
    }));
    mockPrograms({
      students: [fatima],
      programs: { 'student-1': [entry('program-1', 'Hifz Program', 'ACTIVE', thirty)] },
    });
    renderPrograms();

    const card = (await screen.findByRole('heading', { level: 2, name: 'Hifz Program' })).closest(
      'article',
    ) as HTMLElement;
    // 4 achieved -> the last 3 achieved (2, 3, 4) plus the next (5).
    expect(within(card).getAllByRole('listitem')).toHaveLength(4);
    expect(within(card).getByText('Juz 5')).toBeTruthy();
    expect(within(card).queryByText('Juz 1')).toBeNull();

    const toggle = within(card).getByRole('button', { name: 'Show all 30 milestones' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(toggle);

    expect(within(card).getAllByRole('listitem')).toHaveLength(30);
    const fewer = within(card).getByRole('button', { name: 'Show fewer' });
    expect(fewer.getAttribute('aria-expanded')).toBe('true');
  });

  it('renders two enrolments in the same program as separate cards (re-enrol after withdrawal, D19)', async () => {
    mockPrograms({
      students: [fatima],
      programs: {
        'student-1': [
          entry(
            'program-1',
            'Hifz Program',
            'WITHDRAWN',
            [{ id: 'm-1', name: 'Juz 1', achieved: true }],
            'enrollment-old',
          ),
          entry(
            'program-1',
            'Hifz Program',
            'ACTIVE',
            [{ id: 'm-2', name: 'Juz 2', achieved: false }],
            'enrollment-new',
          ),
        ],
      },
    });
    renderPrograms();

    expect(await screen.findByText('Juz 1')).toBeTruthy();
    expect(screen.getByText('Juz 2')).toBeTruthy();
    expect(screen.getAllByText('Hifz Program')).toHaveLength(2);
  });

  it('renders the empty state when the child has no programs', async () => {
    mockPrograms({ students: [fatima], programs: { 'student-1': [] } });
    renderPrograms();

    expect(await screen.findByRole('heading', { level: 2, name: 'No programs yet' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Programs' })).toBeTruthy();
  });

  it('lets a multi-child guardian switch students, re-querying for the chosen child', async () => {
    mockPrograms({
      students: [fatima, imran],
      programs: {
        'student-1': [entry('program-1', 'Hifz Program', 'ACTIVE', [])],
        'student-2': [entry('program-2', 'Sports Club', 'ACTIVE', [])],
      },
    });
    renderPrograms();

    expect(await screen.findByText('Hifz Program')).toBeTruthy();

    await userEvent.click(screen.getByText('Imran Rahman'));

    expect(await screen.findByText('Sports Club')).toBeTruthy();
    expect(screen.queryByText('Hifz Program')).toBeNull();
  });

  describe('visibleMilestones', () => {
    const list = (achievedCount: number, total: number) =>
      Array.from({ length: total }, (_, i) => ({
        id: `m-${i}`,
        name: `M${i}`,
        achievement:
          i < achievedCount ? { achieved_on: '2026-01-10', score: null, grade: null } : null,
      }));

    it('keeps the last three achieved and the next one', () => {
      expect(visibleMilestones(list(4, 30), false).map((m) => m.id)).toEqual([
        'm-1',
        'm-2',
        'm-3',
        'm-4',
      ]);
    });

    it('keeps the last three when all are achieved', () => {
      expect(visibleMilestones(list(6, 6), false).map((m) => m.id)).toEqual(['m-3', 'm-4', 'm-5']);
    });

    it('returns everything for four or fewer', () => {
      expect(visibleMilestones(list(2, 4), false)).toHaveLength(4);
    });

    it('returns everything when expanded', () => {
      expect(visibleMilestones(list(4, 30), true)).toHaveLength(30);
    });
  });

  it('shows an error state when the students query fails', async () => {
    server.use(
      http.get('/api/v1/students/mine', () =>
        HttpResponse.json(apiErrorBody(403, 'Forbidden', '/api/v1/students/mine'), {
          status: 403,
        }),
      ),
    );
    renderPrograms();

    expect(await screen.findByText(/Could not load these programs/)).toBeTruthy();
  });

  it('is axe clean', async () => {
    mockPrograms({
      students: [fatima],
      programs: {
        'student-1': [
          entry('program-1', 'Hifz Program', 'ACTIVE', [
            { id: 'm-1', name: 'Juz 1', achieved: true },
            { id: 'm-2', name: 'Juz 2', achieved: false },
          ]),
        ],
      },
    });
    const { container } = renderPrograms();

    await screen.findByText('Hifz Program');
    await expect(container).toHaveNoViolations();
  });
});
