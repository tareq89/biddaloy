import {
  cleanupTestState,
  renderWithProviders,
  renderWithRouter,
  server,
  studentFactory,
} from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

import { ProgramsPanel } from './programs-panel';

/** [34.5.1] Staff Programs tab on student detail — clone of the Results
 * panel: every enrolment, milestones tickable in place, progress hidden
 * when a program has no milestones (D6/D12), Enrol gated on
 * PROGRAM_MANAGE (D12; TEACHER only gets PROGRAM_READ/PROGRAM_RECORD). */
describe('ProgramsPanel', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  const entryWithMilestones = {
    program: { id: 'program-1', name: 'Reading Club', is_active: true, show_on_report_card: true },
    enrollment: { id: 'enrollment-1', status: 'ACTIVE', started_on: '2026-01-10', ended_on: null },
    milestones: [
      {
        id: 'milestone-1',
        name: 'Read 5 books',
        sequence: 1,
        achievement: null,
      },
    ],
    achieved_count: 0,
    milestone_total: 1,
  };

  const entryNoMilestones = {
    program: { id: 'program-2', name: 'Music', is_active: true, show_on_report_card: false },
    enrollment: { id: 'enrollment-2', status: 'ACTIVE', started_on: '2025-06-01', ended_on: null },
    milestones: [],
    achieved_count: 0,
    milestone_total: 0,
  };

  it('renders every enrolment, hiding progress where there are no milestones', async () => {
    server.use(
      http.get('/api/v1/students/:studentId/programs', () =>
        HttpResponse.json([entryWithMilestones, entryNoMilestones]),
      ),
    );

    renderWithProviders(<ProgramsPanel studentId="student-1" />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: 'tenant-1',
    });

    expect(await screen.findByText('Reading Club')).toBeTruthy();
    expect(screen.getByText('Music')).toBeTruthy();
    expect(screen.getByText('0 / 1')).toBeTruthy();
    expect(screen.queryByText('0 / 0')).toBeNull();
  });

  it('shows a score of 0 instead of dropping it (0 is falsy, not missing)', async () => {
    const entryWithZeroScore = {
      program: { id: 'program-3', name: 'Chess Club', is_active: true, show_on_report_card: true },
      enrollment: {
        id: 'enrollment-3',
        status: 'ACTIVE',
        started_on: '2026-01-10',
        ended_on: null,
      },
      milestones: [
        {
          id: 'milestone-3',
          name: 'Opening puzzle',
          sequence: 1,
          achievement: {
            id: 'ach-1',
            achieved_on: '2026-01-15',
            score: '0',
            grade: null,
            remark: null,
          },
        },
      ],
      achieved_count: 1,
      milestone_total: 1,
    };
    server.use(
      http.get('/api/v1/students/:studentId/programs', () =>
        HttpResponse.json([entryWithZeroScore]),
      ),
    );

    renderWithProviders(<ProgramsPanel studentId="student-1" />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: 'tenant-1',
    });

    expect(await screen.findByText('Chess Club')).toBeTruthy();
    expect(
      screen.getByText((_, element) => element?.textContent === '2026-01-15 · 0'),
    ).toBeTruthy();
  });

  it('shows the empty state with an Enrol CTA only when the user can manage programs', async () => {
    server.use(http.get('/api/v1/students/:studentId/programs', () => HttpResponse.json([])));

    renderWithProviders(<ProgramsPanel studentId="student-1" />, {
      locale: 'en',
      role: 'TEACHER',
      tenantId: 'tenant-1',
    });

    expect(await screen.findByText('Not enrolled in any program')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Enrol' })).toBeNull();
  });

  it('shows the Enrol CTA in the empty state for a manager role', async () => {
    server.use(http.get('/api/v1/students/:studentId/programs', () => HttpResponse.json([])));

    renderWithProviders(<ProgramsPanel studentId="student-1" />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: 'tenant-1',
    });

    expect(await screen.findByText('Not enrolled in any program')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Enrol' })).toBeTruthy();
  });

  it('Space on an unticked milestone opens the record dialog prefilled for that enrolment', async () => {
    server.use(
      http.get('/api/v1/students/:studentId/programs', () =>
        HttpResponse.json([entryWithMilestones]),
      ),
      http.get('/api/v1/programs/:programId', () =>
        HttpResponse.json({
          id: 'program-1',
          name: 'Reading Club',
          is_active: true,
          show_on_report_card: true,
          milestones: [{ id: 'milestone-1', name: 'Read 5 books', sequence: 1 }],
        }),
      ),
      http.get('/api/v1/programs/:programId/enrollments', () =>
        HttpResponse.json([
          {
            id: 'enrollment-1',
            student: { id: 'student-1', full_name: 'Amina Rahman', roll_number: '3' },
            status: 'ACTIVE',
            achieved_count: 0,
            milestone_total: 1,
          },
        ]),
      ),
    );

    function Harness() {
      const [recordId, setRecordId] = React.useState<string | undefined>();
      return (
        <ProgramsPanel
          studentId="student-1"
          recordEnrollmentId={recordId}
          onRecordChange={setRecordId}
        />
      );
    }
    const { user } = renderWithProviders(<Harness />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: 'tenant-1',
    });

    const checkbox = await screen.findByRole('checkbox', { name: /Read 5 books/ });
    checkbox.focus();
    await user.keyboard(' ');

    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
  });
  describe('URL-reflected full pages [31.5.0]', () => {
    const ENROLLMENT_ID = '3f6c1a52-7a1e-4c43-9a43-6f0a3c1d2b11';

    function renderRoute(search: string) {
      const entry = {
        ...entryWithMilestones,
        enrollment: { ...entryWithMilestones.enrollment, id: ENROLLMENT_ID },
      };
      server.use(
        http.get('/api/v1/students/:id', () =>
          HttpResponse.json(studentFactory({ id: 'student-1', full_name: 'Rahim Uddin' })),
        ),
        http.get('/api/v1/students/:studentId/promotion-overrides', () => HttpResponse.json([])),
        http.get('/api/v1/students/:studentId/programs', () => HttpResponse.json([entry])),
        http.get('/api/v1/programs/:programId', () =>
          HttpResponse.json({
            id: 'program-1',
            name: 'Reading Club',
            is_active: true,
            show_on_report_card: true,
            milestones: [{ id: 'milestone-1', name: 'Read 5 books', sequence: 1 }],
          }),
        ),
        http.get('/api/v1/programs', () => HttpResponse.json({ items: [], total: 0 })),
        http.get('/api/v1/programs/:programId/enrollments', () => HttpResponse.json([])),
      );
      return renderWithRouter(routeTree, {
        initialEntries: [`/students/student-1?tab=programs${search}`],
        tenantId: 'tenant-1',
        role: 'ADMIN',
        locale: 'en',
      });
    }

    it('?enrolProgram=1 opens enrol; closing clears only that key', async () => {
      const { router } = renderRoute('&enrolProgram=1');
      await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
      await router.navigate({
        to: '.',
        search: (p: object) => ({ ...p, enrolProgram: undefined }),
      } as never);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(router.state.location.search).toMatchObject({ tab: 'programs' });
    });

    it('?recordMilestone=<enrollmentId> opens record for that row', async () => {
      renderRoute(`&recordMilestone=${ENROLLMENT_ID}`);
      await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    });
  });
});
