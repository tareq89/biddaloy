import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DataSource, QueryRunner } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_ACADEMIC_YEAR_ID, SEED_ADMIN_USER_ID, SEED_TENANT_ID } from '@test/constants';
import { School } from '../schools/entities/school.entity';
import { AcrFormVersion } from './entities/acr-form-version.entity';
import { AcrCriterion } from './entities/acr-criterion.entity';
import { AcrAssessment } from './entities/acr-assessment.entity';
import { AcrScore } from './entities/acr-score.entity';
import { StaffIncident } from '../incidents/entities/staff-incident.entity';
import { Survey } from '../surveys/entities/survey.entity';
import { SurveyQuestion } from '../surveys/entities/survey-question.entity';
import { SurveyResponse } from '../surveys/entities/survey-response.entity';
import { EvaluationsAndPerformance1790900000000 } from '../../migrations/1790900000000-EvaluationsAndPerformance';

/**
 * [28.1.2] Runs against the real migrated schema (not `synchronize`): the
 * CHECK / UNIQUE constraints are migration-only objects. Enum values are
 * string literals on purpose (no `@biddaloy/shared` import; #1226 lands on a
 * different lane).
 */
describe('evaluations & performance schema (integration)', () => {
  let ds: DataSource;
  const TENANT = SEED_TENANT_ID;
  const OTHER_TENANT = '00000000-0000-4000-8000-000000000099';
  const USER = SEED_ADMIN_USER_ID;

  let yearId: string;
  let versionId: string;
  let criterionId: string;
  let surveyId: string;
  let questionId: string;
  let teacherId: string;
  let subjectId: string;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get<DataSource>(getDataSourceToken());
    const schools = ds.getRepository(School);
    if (!(await schools.findOne({ where: { id: TENANT } }))) {
      await schools.save({ id: TENANT, name: 'Test School', slug: 'test-school' });
    }
    if (!(await schools.findOne({ where: { id: OTHER_TENANT } }))) {
      await schools.save({ id: OTHER_TENANT, name: 'Other School', slug: 'other-school' });
    }
  }, 60000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  // The global per-test reset wipes these tables, so seed per test.
  beforeEach(async () => {
    // Reference tables (incl. the seeded academic year) survive the per-test reset.
    yearId = SEED_ACADEMIC_YEAR_ID;
    const version = await ds
      .getRepository(AcrFormVersion)
      .save({ tenant_id: TENANT, version: 1, created_by: USER });
    versionId = version.id;
    const criterion = await ds.getRepository(AcrCriterion).save({
      tenant_id: TENANT,
      form_version_id: versionId,
      block: 'BLOCK_2',
      code: 'B2_1',
      label_en: 'Punctuality',
      label_bn: 'সময়ানুবর্তিতা',
      sort_order: 1,
    });
    criterionId = criterion.id;
    const survey = await ds
      .getRepository(Survey)
      .save({ tenant_id: TENANT, title: 'Term 1', respondent: 'STUDENTS' });
    surveyId = survey.id;
    const question = await ds
      .getRepository(SurveyQuestion)
      .save({ tenant_id: TENANT, survey_id: surveyId, text: 'Clear?', sort_order: 1 });
    questionId = question.id;
    const [subject] = await ds.query(
      `INSERT INTO subjects (name_en, code, tenant_id) VALUES ('Math', 'MTH', $1) RETURNING id`,
      [TENANT],
    );
    subjectId = subject.id;
    // Raw insert bypasses TeacherStaffProfileSubscriber, hence the staff_profiles CTE.
    const [teacher] = await ds.query(
      `WITH sp AS (
         INSERT INTO staff_profiles (id, user_id, tenant_id, employee_id, created_at, updated_at)
         VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 'EMP-ACR', NOW(), NOW())
         ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
         RETURNING id
       )
       INSERT INTO teachers (id, user_id, employee_id, designations, tenant_id, staff_profile_id, created_at, updated_at)
       SELECT gen_random_uuid(), $1::uuid, 'ACR-TEACHER', '{}', $2::uuid, sp.id, NOW(), NOW() FROM sp
       RETURNING id`,
      [USER, TENANT],
    );
    teacherId = teacher.id;
  });

  async function assessment(tenant = TENANT) {
    return ds.getRepository(AcrAssessment).save({
      tenant_id: tenant,
      user_id: USER,
      academic_year_id: yearId,
      form_version_id: versionId,
      assessed_by: USER,
    });
  }

  it('rejects an ACR score of 5 and accepts 1-4', async () => {
    const a = await assessment();
    const scores = ds.getRepository(AcrScore);
    await expect(
      scores.save({ tenant_id: TENANT, assessment_id: a.id, criterion_id: criterionId, score: 5 }),
    ).rejects.toThrow(/CHK_acr_scores_score/);
    await expect(
      scores.save({ tenant_id: TENANT, assessment_id: a.id, criterion_id: criterionId, score: 4 }),
    ).resolves.toBeDefined();
  });

  it('enforces UNIQUE (tenant, user, year) on assessments, per tenant', async () => {
    await assessment();
    await expect(assessment()).rejects.toThrow(/UQ_acr_assessments_tenant_user_year/);
  });

  it('enforces UNIQUE (tenant, version) on form versions', async () => {
    await expect(
      ds.getRepository(AcrFormVersion).save({ tenant_id: TENANT, version: 1, created_by: USER }),
    ).rejects.toThrow(/UQ_acr_form_versions_tenant_version/);
  });

  it('enforces UNIQUE survey+respondent+teacher+subject on responses', async () => {
    const repo = ds.getRepository(SurveyResponse);
    const row = {
      tenant_id: TENANT,
      survey_id: surveyId,
      respondent_user_id: USER,
      teacher_id: teacherId,
      subject_id: subjectId,
    };
    await repo.save({ ...row });
    await expect(repo.save({ ...row })).rejects.toThrow(/UQ_survey_responses_once/);
    expect(questionId).toBeDefined();
  });

  it('rejects survey answer stars of 6', async () => {
    const resp = await ds.getRepository(SurveyResponse).save({
      tenant_id: TENANT,
      survey_id: surveyId,
      respondent_user_id: USER,
      teacher_id: teacherId,
      subject_id: subjectId,
    });
    await expect(
      ds.query(
        `INSERT INTO survey_answers (tenant_id, response_id, question_id, stars) VALUES ($1, $2, $3, 6)`,
        [TENANT, resp.id, questionId],
      ),
    ).rejects.toThrow(/CHK_survey_answers_stars/);
  });

  it('rejects student_notes.rating of 6 and accepts 5 and NULL', async () => {
    const [klass] = await ds.query(
      `INSERT INTO classes (name, numeric_grade, academic_year_id, tenant_id)
       VALUES ('acr-class', 6, $1, $2) RETURNING id`,
      [yearId, TENANT],
    );
    const [section] = await ds.query(
      `INSERT INTO class_sections (class_id, section_name, tenant_id) VALUES ($1, 'A', $2) RETURNING id`,
      [klass.id, TENANT],
    );
    const [student] = await ds.query(
      `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id)
       VALUES ('N', 'N-1', 1, $1, $2) RETURNING id`,
      [section.id, TENANT],
    );
    const insert = (rating: number | null) =>
      ds.query(
        `INSERT INTO student_notes (tenant_id, student_id, author_user_id, body, rating)
         VALUES ($1, $2, $3, 'x', $4)`,
        [TENANT, student.id, USER, rating],
      );
    await expect(insert(6)).rejects.toThrow(/CHK_student_notes_rating/);
    await expect(insert(5)).resolves.toBeDefined();
    await expect(insert(null)).resolves.toBeDefined();
  });

  it('rejects out-of-list incident type/severity and survey status', async () => {
    await expect(
      ds.query(
        `INSERT INTO staff_incidents (tenant_id, staff_user_id, type, severity, body, occurred_on, reported_by)
         VALUES ($1, $2, 'BOGUS', 'LOW', 'b', '2026-01-01', $2)`,
        [TENANT, USER],
      ),
    ).rejects.toThrow(/CHK_staff_incidents_type/);
    await expect(
      ds.query(`UPDATE surveys SET status = 'BOGUS' WHERE id = $1`, [surveyId]),
    ).rejects.toThrow(/CHK_surveys_status/);
  });

  it('keeps incidents and assessments isolated per tenant', async () => {
    const incidents = ds.getRepository(StaffIncident);
    const base = {
      staff_user_id: USER,
      type: 'OTHER' as const,
      severity: 'LOW' as const,
      body: 'b',
      occurred_on: '2026-01-01',
      reported_by: USER,
    };
    await incidents.save({ ...base, tenant_id: TENANT });
    await incidents.save({ ...base, tenant_id: OTHER_TENANT });
    await assessment();

    expect(await incidents.count({ where: { tenant_id: TENANT } })).toBe(1);
    expect(await incidents.count({ where: { tenant_id: OTHER_TENANT } })).toBe(1);
    expect(
      await ds.getRepository(AcrAssessment).count({ where: { tenant_id: OTHER_TENANT } }),
    ).toBe(0);
  });

  it('migrates down and back up', async () => {
    const migration = new EvaluationsAndPerformance1790900000000();
    const run = async (fn: (qr: QueryRunner) => Promise<void>) => {
      const qr = ds.createQueryRunner();
      await qr.connect();
      try {
        await fn(qr);
      } finally {
        await qr.release();
      }
    };
    // Children first: clear rows the FKs would otherwise RESTRICT on.
    await ds.query(
      `TRUNCATE survey_answers, survey_responses, survey_targets, survey_questions, surveys,
        staff_incidents, acr_scores, acr_assessments, acr_criteria, acr_form_versions CASCADE`,
    );
    await run((qr) => migration.down(qr));
    const [{ t }] = await ds.query(`SELECT to_regclass('public.acr_scores') AS t`);
    expect(t).toBeNull();
    await run((qr) => migration.up(qr));
    const [{ t: after }] = await ds.query(`SELECT to_regclass('public.acr_scores') AS t`);
    expect(after).toBe('acr_scores');
  });
});
