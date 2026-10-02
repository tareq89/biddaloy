import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [28.1.2] Epic 28.0 schema: ACR (annual confidential report) forms and
 * assessments, staff incidents, surveys, and `student_notes.rating`.
 *
 * Enum-like columns are varchar + CHECK (not Postgres enums) so later
 * tickets can widen a list without `ALTER TYPE`. Every table carries
 * `tenant_id NOT NULL` with an FK to `schools` and a `(tenant_id, ...)` index.
 * Nothing here is soft-deleted; `staff_incidents` and
 * `survey_responses.respondent_user_id` are privacy-sensitive.
 */
export class EvaluationsAndPerformance1790900000000 implements MigrationInterface {
  name = 'EvaluationsAndPerformance1790900000000';

  private async fk(
    q: QueryRunner,
    table: string,
    col: string,
    ref: string,
    onDelete: 'CASCADE' | 'RESTRICT' = 'RESTRICT',
  ) {
    const name = col === 'tenant_id' ? 'tenant' : col.replace(/_id$/, '');
    await q.query(
      `ALTER TABLE "${table}" ADD CONSTRAINT "FK_${table}_${name}" FOREIGN KEY ("${col}") REFERENCES "${ref}"("id") ON DELETE ${onDelete} ON UPDATE NO ACTION`,
    );
  }

  /** Composite (tenant_id, col) -> ref(tenant_id, id): a child can't point at another tenant's parent. */
  private async cfk(q: QueryRunner, table: string, col: string, ref: string) {
    await q.query(
      `ALTER TABLE "${table}" ADD CONSTRAINT "FK_${table}_${col.replace(/_id$/, '')}" FOREIGN KEY ("tenant_id", "${col}") REFERENCES "${ref}"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async up(q: QueryRunner): Promise<void> {
    // ---- ACR ----
    await q.query(`
      CREATE TABLE "acr_form_versions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "version" integer NOT NULL,
        "created_by" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_acr_form_versions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_acr_form_versions_tenant_id" UNIQUE ("tenant_id", "id"),
        CONSTRAINT "UQ_acr_form_versions_tenant_version" UNIQUE ("tenant_id", "version")
      )
    `);
    await this.fk(q, 'acr_form_versions', 'tenant_id', 'schools', 'CASCADE');
    await this.fk(q, 'acr_form_versions', 'created_by', 'users');

    await q.query(`
      CREATE TABLE "acr_criteria" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "form_version_id" uuid NOT NULL,
        "block" character varying(20) NOT NULL,
        "code" character varying(50) NOT NULL,
        "label_en" text NOT NULL,
        "label_bn" text NOT NULL,
        "sort_order" integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_acr_criteria" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_acr_criteria_tenant_id" UNIQUE ("tenant_id", "id"),
        CONSTRAINT "CHK_acr_criteria_block" CHECK ("block" IN ('BLOCK_2', 'BLOCK_3'))
      )
    `);
    await q.query(
      `CREATE INDEX "IDX_acr_criteria_tenant_form" ON "acr_criteria" ("tenant_id", "form_version_id")`,
    );
    await this.fk(q, 'acr_criteria', 'tenant_id', 'schools', 'CASCADE');
    await this.cfk(q, 'acr_criteria', 'form_version_id', 'acr_form_versions');

    await q.query(`
      CREATE TABLE "acr_assessments" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "academic_year_id" uuid NOT NULL,
        "form_version_id" uuid NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'INCOMPLETE',
        "total" integer,
        "assessed_by" uuid NOT NULL,
        "step1_data" jsonb,
        "step3_data" jsonb,
        "completed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_acr_assessments" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_acr_assessments_tenant_id" UNIQUE ("tenant_id", "id"),
        CONSTRAINT "UQ_acr_assessments_tenant_user_year" UNIQUE ("tenant_id", "user_id", "academic_year_id"),
        CONSTRAINT "CHK_acr_assessments_status" CHECK ("status" IN ('INCOMPLETE', 'COMPLETED'))
      )
    `);
    await this.fk(q, 'acr_assessments', 'tenant_id', 'schools', 'CASCADE');
    await this.fk(q, 'acr_assessments', 'user_id', 'users');
    await this.fk(q, 'acr_assessments', 'academic_year_id', 'academic_years');
    await this.cfk(q, 'acr_assessments', 'form_version_id', 'acr_form_versions');
    await this.fk(q, 'acr_assessments', 'assessed_by', 'users');

    await q.query(`
      CREATE TABLE "acr_scores" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "assessment_id" uuid NOT NULL,
        "criterion_id" uuid NOT NULL,
        "score" smallint NOT NULL,
        CONSTRAINT "PK_acr_scores" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_acr_scores_assessment_criterion" UNIQUE ("assessment_id", "criterion_id"),
        CONSTRAINT "CHK_acr_scores_score" CHECK ("score" IN (1, 2, 3, 4))
      )
    `);
    await q.query(
      `CREATE INDEX "IDX_acr_scores_tenant_assessment" ON "acr_scores" ("tenant_id", "assessment_id")`,
    );
    await this.fk(q, 'acr_scores', 'tenant_id', 'schools', 'CASCADE');
    await this.cfk(q, 'acr_scores', 'assessment_id', 'acr_assessments');
    await this.cfk(q, 'acr_scores', 'criterion_id', 'acr_criteria');

    // ---- Staff incidents (D15: no attachment table) ----
    await q.query(`
      CREATE TABLE "staff_incidents" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "staff_user_id" uuid NOT NULL,
        "type" character varying(20) NOT NULL,
        "severity" character varying(20) NOT NULL,
        "body" text NOT NULL,
        "occurred_on" date NOT NULL,
        "reported_by" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_staff_incidents" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_staff_incidents_type" CHECK ("type" IN ('BEHAVIOUR', 'ABSENCE', 'COMPLAINT', 'COMMENDATION', 'OTHER')),
        CONSTRAINT "CHK_staff_incidents_severity" CHECK ("severity" IN ('LOW', 'MEDIUM', 'HIGH'))
      )
    `);
    await q.query(
      `CREATE INDEX "IDX_staff_incidents_tenant_staff" ON "staff_incidents" ("tenant_id", "staff_user_id")`,
    );
    await this.fk(q, 'staff_incidents', 'tenant_id', 'schools', 'CASCADE');
    await this.fk(q, 'staff_incidents', 'staff_user_id', 'users');
    await this.fk(q, 'staff_incidents', 'reported_by', 'users');

    // ---- Surveys ----
    await q.query(`
      CREATE TABLE "surveys" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "title" character varying(200) NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'DRAFT',
        "anonymous" boolean NOT NULL DEFAULT true,
        "respondent" character varying(20) NOT NULL,
        "opens_at" timestamptz,
        "closes_at" timestamptz,
        "min_responses" integer NOT NULL DEFAULT 5,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_surveys" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_surveys_tenant_id" UNIQUE ("tenant_id", "id"),
        CONSTRAINT "CHK_surveys_status" CHECK ("status" IN ('DRAFT', 'OPEN', 'CLOSED')),
        CONSTRAINT "CHK_surveys_respondent" CHECK ("respondent" IN ('STUDENTS', 'GUARDIANS', 'BOTH'))
      )
    `);
    await q.query(`CREATE INDEX "IDX_surveys_tenant_status" ON "surveys" ("tenant_id", "status")`);
    await this.fk(q, 'surveys', 'tenant_id', 'schools', 'CASCADE');

    await q.query(`
      CREATE TABLE "survey_questions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "survey_id" uuid NOT NULL,
        "sort_order" integer NOT NULL DEFAULT 0,
        "text" text NOT NULL,
        "stars_enabled" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_survey_questions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_survey_questions_tenant_id" UNIQUE ("tenant_id", "id")
      )
    `);
    await q.query(
      `CREATE INDEX "IDX_survey_questions_tenant_survey" ON "survey_questions" ("tenant_id", "survey_id")`,
    );
    await this.fk(q, 'survey_questions', 'tenant_id', 'schools', 'CASCADE');
    await this.cfk(q, 'survey_questions', 'survey_id', 'surveys');

    await q.query(`
      CREATE TABLE "survey_targets" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "survey_id" uuid NOT NULL,
        "teacher_id" uuid NOT NULL,
        "subject_id" uuid NOT NULL,
        CONSTRAINT "PK_survey_targets" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_survey_targets_survey_teacher_subject" UNIQUE ("survey_id", "teacher_id", "subject_id")
      )
    `);
    await q.query(
      `CREATE INDEX "IDX_survey_targets_tenant_survey" ON "survey_targets" ("tenant_id", "survey_id")`,
    );
    await this.fk(q, 'survey_targets', 'tenant_id', 'schools', 'CASCADE');
    await this.cfk(q, 'survey_targets', 'survey_id', 'surveys');
    await this.fk(q, 'survey_targets', 'teacher_id', 'teachers');
    await this.fk(q, 'survey_targets', 'subject_id', 'subjects');

    await q.query(`
      CREATE TABLE "survey_responses" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "survey_id" uuid NOT NULL,
        "respondent_user_id" uuid NOT NULL,
        "teacher_id" uuid NOT NULL,
        "subject_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_survey_responses" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_survey_responses_tenant_id" UNIQUE ("tenant_id", "id"),
        CONSTRAINT "UQ_survey_responses_once" UNIQUE ("survey_id", "respondent_user_id", "teacher_id", "subject_id")
      )
    `);
    await q.query(
      `CREATE INDEX "IDX_survey_responses_tenant_survey" ON "survey_responses" ("tenant_id", "survey_id")`,
    );
    await this.fk(q, 'survey_responses', 'tenant_id', 'schools', 'CASCADE');
    await this.cfk(q, 'survey_responses', 'survey_id', 'surveys');
    await this.fk(q, 'survey_responses', 'respondent_user_id', 'users');
    await this.fk(q, 'survey_responses', 'teacher_id', 'teachers');
    await this.fk(q, 'survey_responses', 'subject_id', 'subjects');

    await q.query(`
      CREATE TABLE "survey_answers" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "response_id" uuid NOT NULL,
        "question_id" uuid NOT NULL,
        "text" text,
        "stars" smallint,
        CONSTRAINT "PK_survey_answers" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_survey_answers_stars" CHECK ("stars" IS NULL OR "stars" BETWEEN 1 AND 5)
      )
    `);
    await q.query(
      `CREATE INDEX "IDX_survey_answers_tenant_response" ON "survey_answers" ("tenant_id", "response_id")`,
    );
    await this.fk(q, 'survey_answers', 'tenant_id', 'schools', 'CASCADE');
    await this.cfk(q, 'survey_answers', 'response_id', 'survey_responses');
    await this.cfk(q, 'survey_answers', 'question_id', 'survey_questions');

    // ---- student_notes.rating ----
    await q.query(
      `ALTER TABLE "student_notes" ADD COLUMN "rating" smallint NULL CONSTRAINT "CHK_student_notes_rating" CHECK ("rating" BETWEEN 1 AND 5)`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "student_notes" DROP COLUMN "rating"`);
    for (const t of [
      'survey_answers',
      'survey_responses',
      'survey_targets',
      'survey_questions',
      'surveys',
      'staff_incidents',
      'acr_scores',
      'acr_assessments',
      'acr_criteria',
      'acr_form_versions',
    ]) {
      await q.query(`DROP TABLE IF EXISTS "${t}"`);
    }
  }
}
