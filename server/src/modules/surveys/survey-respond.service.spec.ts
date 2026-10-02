import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserRole } from '@biddaloy/shared';
import { SurveyRespondService } from './survey-respond.service';
import { SurveyResultsService } from './survey-results.service';

const TENANT = 'tenant-1';
const USER = 'respondent-user-id-SECRET';
const T1 = 'teacher-1';
const S1 = 'subject-1';
const Q1 = 'q1';

describe('SurveyRespondService', () => {
  let survey: Record<string, unknown> | null;
  let query: ReturnType<typeof vi.fn>;
  let save: ReturnType<typeof vi.fn>;
  let surveyRepo: Record<string, unknown>;
  let questionRepo: { find: ReturnType<typeof vi.fn> };
  let family: { getLinkedStudentIds: ReturnType<typeof vi.fn> };
  let service: SurveyRespondService;

  const dto = (over = {}) => ({
    teacherId: T1,
    subjectId: S1,
    answers: [{ questionId: Q1, stars: 4, text: 'good' }],
    ...over,
  });

  beforeEach(() => {
    survey = {
      id: 's1',
      tenant_id: TENANT,
      status: 'OPEN',
      respondent: 'BOTH',
      opens_at: null,
      closes_at: null,
    };
    query = vi.fn(async () => [{ survey_id: 's1', teacher_id: T1, subject_id: S1 }]);
    save = vi.fn(async (_e: unknown, v: Record<string, unknown>) => ({ id: 'r1', ...v }));
    const manager = {
      create: vi.fn((_e: unknown, v: unknown) => v),
      save,
      transaction: undefined,
    };
    surveyRepo = {
      findOne: vi.fn(async () => survey),
      find: vi.fn(async () => [survey]),
      query,
      manager: { transaction: vi.fn(async (fn: (m: unknown) => unknown) => fn(manager)) },
    };
    questionRepo = { find: vi.fn(async () => [{ id: Q1, survey_id: 's1', stars_enabled: true }]) };
    family = { getLinkedStudentIds: vi.fn(async () => ['stu-1']) };
    service = new SurveyRespondService(surveyRepo as never, questionRepo as never, family as never);
  });

  it('eligible student responds', async () => {
    const r = await service.respond('s1', dto(), UserRole.STUDENT, USER, TENANT);
    expect(r).toEqual({ teacherId: T1, subjectId: S1, submitted: true });
  });

  it('ineligible student (no teaching row for that pair) gets 403', async () => {
    query.mockResolvedValue([]);
    await expect(service.respond('s1', dto(), UserRole.STUDENT, USER, TENANT)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('caller with no linked students gets 403', async () => {
    family.getLinkedStudentIds.mockResolvedValue([]);
    await expect(service.respond('s1', dto(), UserRole.PARENT, USER, TENANT)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('wrong respondent group gets 403', async () => {
    survey!.respondent = 'GUARDIANS';
    await expect(service.respond('s1', dto(), UserRole.STUDENT, USER, TENANT)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('unique violation (23505) maps to 409', async () => {
    save.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));
    await expect(service.respond('s1', dto(), UserRole.STUDENT, USER, TENANT)).rejects.toThrow(
      ConflictException,
    );
  });

  it('closed survey gets 409; cross-tenant survey gets 404', async () => {
    survey!.status = 'CLOSED';
    await expect(service.respond('s1', dto(), UserRole.STUDENT, USER, TENANT)).rejects.toThrow(
      ConflictException,
    );
    survey = null;
    await expect(service.respond('s1', dto(), UserRole.STUDENT, USER, TENANT)).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('SurveyResultsService', () => {
  let survey: Record<string, unknown>;
  let targets: { teacher_id: string; subject_id: string }[];
  let teachers: { id: string }[];
  let counts: unknown[];
  let answered: number;
  let service: SurveyResultsService;

  beforeEach(() => {
    survey = {
      id: 's1',
      title: 'T',
      anonymous: true,
      min_responses: 3,
      status: 'CLOSED',
      tenant_id: TENANT,
    };
    targets = [{ teacher_id: T1, subject_id: S1 }];
    teachers = [];
    answered = 3;
    counts = [{ teacher_id: T1, subject_id: S1, count: 2 }];
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('AVG('))
        return [{ teacher_id: T1, subject_id: S1, question_id: Q1, avg: 4.256, n: answered }];
      if (sql.includes('COUNT(*)')) return counts;
      return [
        { teacher_id: T1, subject_id: S1, question_id: Q1, text: 'a comment' },
        { teacher_id: T1, subject_id: S1, question_id: Q1, text: 'b comment' },
      ];
    });
    service = new SurveyResultsService(
      { findOne: vi.fn(async () => survey), query } as never,
      { find: vi.fn(async () => [{ id: Q1, text: 'Clear?' }]) } as never,
      { find: vi.fn(async () => targets) } as never,
      { find: vi.fn(async () => teachers) } as never,
    );
  });

  it('below min_responses returns only {teacherId, subjectId, count, hidden}', async () => {
    const r = await service.getResults('s1', UserRole.ADMIN, 'admin', TENANT);
    expect(r.results[0]).toStrictEqual({ teacherId: T1, subjectId: S1, count: 2, hidden: true });
  });

  it('at min_responses returns rounded averages and text-sorted comments, no respondent data', async () => {
    counts = [{ teacher_id: T1, subject_id: S1, count: 3 }];
    const r = await service.getResults('s1', UserRole.ADMIN, 'admin', TENANT);
    const json = JSON.stringify(r);
    expect(r.results[0]).toMatchObject({ hidden: false, count: 3 });
    expect(json).toContain('4.26');
    expect(json).not.toMatch(/respondent|user_id|created_at|SECRET/i);
    const q = (r.results[0] as { questions: { comments: string[] }[] }).questions[0];
    expect(q.comments).toEqual(['a comment', 'b comment']);
  });

  it('a question answered by fewer than min_responses people shows no average or comments', async () => {
    counts = [{ teacher_id: T1, subject_id: S1, count: 3 }];
    answered = 2; // one respondent skipped this question
    const r = await service.getResults('s1', UserRole.ADMIN, 'admin', TENANT);
    const q = (r.results[0] as { questions: unknown[] }).questions[0];
    expect(q).toStrictEqual({ questionId: Q1, text: 'Clear?', averageStars: null, comments: [] });
  });

  it('per-question n counts STAR answers only (COUNT(a.stars)), so text-only answers cannot unseal a question', async () => {
    const query = vi.fn(async () => []);
    const svc = new SurveyResultsService(
      { findOne: vi.fn(async () => survey), query } as never,
      { find: vi.fn(async () => []) } as never,
      { find: vi.fn(async () => targets) } as never,
      { find: vi.fn(async () => teachers) } as never,
    );
    await svc.getResults('s1', UserRole.ADMIN, 'admin', TENANT);
    const avgSql = (query.mock.calls as unknown as [string][])
      .map(([sql]) => sql)
      .find((sql) => sql.includes('AVG('))!;
    expect(avgSql).toContain('COUNT(a.stars)::int AS n');
    expect(avgSql).not.toMatch(/COUNT\(\*\)/);
  });

  it('while the survey is not CLOSED every pair is hidden, even at or above min_responses', async () => {
    counts = [{ teacher_id: T1, subject_id: S1, count: 9 }];
    survey.status = 'OPEN';
    const r = await service.getResults('s1', UserRole.ADMIN, 'admin', TENANT);
    expect(r.results[0]).toStrictEqual({ teacherId: T1, subjectId: S1, count: 9, hidden: true });
  });

  it('a non-ACR_READ role gets 404', async () => {
    await expect(service.getResults('s1', UserRole.TEACHER, 'u', TENANT)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('a target teacher gets 404 on the whole route', async () => {
    teachers = [{ id: T1 }];
    await expect(service.getResults('s1', UserRole.ADMIN, 'u', TENANT)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('cross-tenant survey gets 404', async () => {
    const s = new SurveyResultsService(
      { findOne: vi.fn(async () => null) } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(s.getResults('s1', UserRole.ADMIN, 'u', TENANT)).rejects.toThrow(
      NotFoundException,
    );
  });
});
