import { describe, expect, it } from 'vitest';
import type { Repository } from 'typeorm';
import {
  ACR_DEFAULT_CRITERIA,
  SEED_SURVEY_RESPONSES,
  ensureEvaluationsSeed,
  seedScore,
  type EvaluationsSeedRepositories,
} from './seed.evaluations';

/** Minimal in-memory repo: findOne by equality, create, save. */
class FakeRepo {
  readonly rows: Record<string, unknown>[] = [];
  private n = 0;
  constructor(private readonly prefix: string) {}
  findOne({ where }: { where: Record<string, unknown> }) {
    const hit = this.rows.find((r) => Object.entries(where).every(([k, v]) => r[k] === v));
    return Promise.resolve(hit ?? null);
  }
  create(data: Record<string, unknown>) {
    return { ...data };
  }
  save(e: Record<string, unknown>) {
    if (e.id === undefined) e.id = `${this.prefix}-${(this.n += 1)}`;
    if (!this.rows.includes(e)) this.rows.push(e);
    return Promise.resolve(e);
  }
}

const TENANT = 'school-1';

function setup() {
  const r = Object.fromEntries(
    [
      'user',
      'userTenant',
      'academicYear',
      'subject',
      'teacher',
      'student',
      'note',
      'formVersion',
      'criterion',
      'assessment',
      'score',
      'incident',
      'survey',
      'surveyQuestion',
      'surveyTarget',
      'surveyResponse',
      'surveyAnswer',
    ].map((k) => [k, new FakeRepo(k)]),
  ) as Record<string, FakeRepo>;
  void r.academicYear.save({ tenant_id: TENANT, name: '2026-2027' });
  void r.user.save({ email: 'teacher@biddaloy.test' });
  void r.user.save({ email: 'accountant@biddaloy.test' });
  void r.teacher.save({ tenant_id: TENANT, user_id: r.user.rows[0]!.id });
  void r.subject.save({ tenant_id: TENANT, code: 'MATH' });
  void r.student.save({ tenant_id: TENANT, registration_number: '2026-2027-0004' });
  void r.note.save({ tenant_id: TENANT, student_id: r.student.rows[0]!.id, rating: null });
  const repos = Object.fromEntries(
    Object.entries(r).map(([k, v]) => [`${k}Repository`, v as unknown as Repository<never>]),
  ) as unknown as EvaluationsSeedRepositories;
  return { r, repos };
}

const counts = (r: Record<string, FakeRepo>) =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.rows.length]));

describe('ensureEvaluationsSeed [28.1.4]', () => {
  it('seeds form, ACRs, survey, incidents and a note rating', async () => {
    const { r, repos } = setup();
    await ensureEvaluationsSeed(repos, TENANT, 'admin-1');

    expect(ACR_DEFAULT_CRITERIA).toHaveLength(25);
    expect(r.criterion.rows).toHaveLength(25);
    expect(r.assessment.rows.map((a) => a.status).sort()).toEqual(['COMPLETED', 'INCOMPLETE']);
    expect(r.incident.rows).toHaveLength(2);
    expect(r.note.rows[0]!.rating).toBe(4);
    // survey passes min-N
    const survey = r.survey.rows[0]!;
    expect(survey.status).toBe('OPEN');
    expect(r.surveyResponse.rows).toHaveLength(SEED_SURVEY_RESPONSES);
    expect(SEED_SURVEY_RESPONSES).toBeGreaterThanOrEqual(survey.min_responses as number);
  });

  it('completed ACR total equals the sum of its scores', async () => {
    const { r, repos } = setup();
    await ensureEvaluationsSeed(repos, TENANT, 'admin-1');
    const done = r.assessment.rows.find((a) => a.status === 'COMPLETED')!;
    const sum = r.score.rows
      .filter((s) => s.assessment_id === done.id)
      .reduce((t, s) => t + (s.score as number), 0);
    expect(done.total).toBe(sum);
    expect(sum).toBe(ACR_DEFAULT_CRITERIA.reduce((t, _c, i) => t + seedScore(i), 0));
  });

  it('is idempotent: a second run adds no rows', async () => {
    const { r, repos } = setup();
    await ensureEvaluationsSeed(repos, TENANT, 'admin-1');
    const first = counts(r);
    await ensureEvaluationsSeed(repos, TENANT, 'admin-1');
    expect(counts(r)).toEqual(first);
  });
});
