import { waitFor } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import {
  type Program,
  type StudentProgramEntry,
  studentProgramKeys,
  useProgram,
  usePrograms,
  useRecordAchievements,
  useRemoveAchievement,
} from './programs';

function programFactory(overrides: Partial<Program> = {}): Program {
  return {
    id: 'program-1',
    name: 'Hifz Circle',
    description: null,
    is_active: true,
    show_on_report_card: true,
    milestone_count: 1,
    active_enrollment_count: 1,
    ...overrides,
  };
}

function studentProgramFactory(overrides: Partial<StudentProgramEntry> = {}): StudentProgramEntry {
  return {
    program: { id: 'program-1', name: 'Hifz Circle', is_active: true, show_on_report_card: true },
    enrollment: {
      id: 'enrollment-1',
      status: 'ACTIVE',
      started_on: '2026-01-01',
      ended_on: null,
    },
    milestones: [{ id: 'milestone-1', name: 'Juz 1', sequence: 1, achievement: null }],
    achieved_count: 0,
    milestone_total: 1,
    ...overrides,
  };
}

describe('usePrograms', () => {
  it('resolves with every program the handler returns', async () => {
    server.use(
      http.get('/api/v1/programs', () =>
        HttpResponse.json([
          programFactory({ id: 'program-1' }),
          programFactory({ id: 'program-2' }),
        ]),
      ),
    );

    const { result } = renderHookWithProviders(() => usePrograms(), { tenantId: 'tenant-1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((p) => p.id)).toEqual(['program-1', 'program-2']);
  });
});

describe('useProgram', () => {
  it('resolves with the program and its milestones', async () => {
    server.use(
      http.get('/api/v1/programs/program-1', () =>
        HttpResponse.json(
          programFactory({
            milestones: [
              {
                id: 'milestone-1',
                program_id: 'program-1',
                name: 'Juz 1',
                description: null,
                sequence: 1,
              },
            ],
          }),
        ),
      ),
    );

    const { result } = renderHookWithProviders(() => useProgram('program-1'), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.milestones).toHaveLength(1);
  });

  it('preserves shouldRetryQuery semantics — a 404 surfaces as an error, not a retry loop', async () => {
    let requestCount = 0;
    server.use(
      http.get('/api/v1/programs/missing', () => {
        requestCount += 1;
        return HttpResponse.json(
          { statusCode: 404, message: 'Program "missing" not found', requestId: 'req-1' },
          { status: 404 },
        );
      }),
    );

    const { result } = renderHookWithProviders(() => useProgram('missing'), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    // shouldRetryQuery: a 4xx never retries — one request, not TanStack's
    // default up-to-3 attempts.
    expect(requestCount).toBe(1);
  });
});

describe('useRecordAchievements', () => {
  it('invalidates both the program and the student-programs key families', async () => {
    server.use(
      http.post('/api/v1/programs/program-1/achievements', () =>
        HttpResponse.json({ upserted: 1 }, { status: 201 }),
      ),
    );

    const { result, queryClient } = renderHookWithProviders(() => useRecordAchievements(), {
      tenantId: 'tenant-1',
    });

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    result.current.mutate({
      programId: 'program-1',
      studentId: 'student-1',
      input: { enrollment_ids: ['enrollment-1'], milestone_id: 'milestone-1' },
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
    expect(invalidatedKeys).toContainEqual(['programs', 'detail', 'program-1']);
    expect(invalidatedKeys).toContainEqual(studentProgramKeys('student-1'));
  });

  it('ticks the milestone immediately, then rolls back on a 500', async () => {
    server.use(
      http.post('/api/v1/programs/program-1/achievements', async () => {
        await delay(50);
        return HttpResponse.json({ message: 'boom' }, { status: 500 });
      }),
    );

    const { result, queryClient } = renderHookWithProviders(() => useRecordAchievements(), {
      tenantId: 'tenant-1',
      seedQueries: [
        {
          queryKey: studentProgramKeys('student-1'),
          data: [studentProgramFactory()],
        },
      ],
    });

    result.current.mutate({
      programId: 'program-1',
      studentId: 'student-1',
      input: { enrollment_ids: ['enrollment-1'], milestone_id: 'milestone-1' },
    });

    await waitFor(() => {
      const cached = queryClient.getQueryData<StudentProgramEntry[]>(
        studentProgramKeys('student-1'),
      );
      expect(cached?.[0]?.milestones[0]?.achievement).not.toBeNull();
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    const rolledBack = queryClient.getQueryData<StudentProgramEntry[]>(
      studentProgramKeys('student-1'),
    );
    expect(rolledBack?.[0]?.milestones[0]?.achievement).toBeNull();
  });
});

describe('useRemoveAchievement', () => {
  it('unticks immediately, then rolls back on a 500', async () => {
    server.use(
      http.delete('/api/v1/milestone-achievements/achievement-1', async () => {
        await delay(50);
        return HttpResponse.json({ message: 'boom' }, { status: 500 });
      }),
    );

    const seeded = studentProgramFactory({
      milestones: [
        {
          id: 'milestone-1',
          name: 'Juz 1',
          sequence: 1,
          achievement: {
            id: 'achievement-1',
            achieved_on: '2026-01-01',
            score: null,
            grade: null,
            remark: null,
          },
        },
      ],
      achieved_count: 1,
    });

    const { result, queryClient } = renderHookWithProviders(() => useRemoveAchievement(), {
      tenantId: 'tenant-1',
      seedQueries: [{ queryKey: studentProgramKeys('student-1'), data: [seeded] }],
    });

    result.current.mutate({
      achievementId: 'achievement-1',
      programId: 'program-1',
      studentId: 'student-1',
      milestoneId: 'milestone-1',
    });

    await waitFor(() => {
      const cached = queryClient.getQueryData<StudentProgramEntry[]>(
        studentProgramKeys('student-1'),
      );
      expect(cached?.[0]?.milestones[0]?.achievement).toBeNull();
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    const rolledBack = queryClient.getQueryData<StudentProgramEntry[]>(
      studentProgramKeys('student-1'),
    );
    expect(rolledBack?.[0]?.milestones[0]?.achievement?.id).toBe('achievement-1');
  });
});
