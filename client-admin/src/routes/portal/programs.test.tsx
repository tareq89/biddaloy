import {
  apiErrorBody,
  classFactory,
  classSectionFactory,
  renderWithRouter,
  server,
  studentFactory,
} from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../routeTree.gen';

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

    expect(await screen.findByText(/No programs yet/)).toBeTruthy();
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
});
