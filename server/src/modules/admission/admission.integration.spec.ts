import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { SEED_TENANT_ID, SEED_SECTION_1_ID, SEED_ADMIN_USER_ID } from '@test/constants';
import { AdmissionApplicantService } from './admission-applicant.service';
import { ApplicantReviewService } from './applicant-review.service';
import { AdmissionIntake } from './entities/admission-intake.entity';
import { AdmissionApplicant } from './entities/admission-applicant.entity';
import { AdmissionEvaluation } from './entities/admission-evaluation.entity';
import { StudentService, GuardianService } from '../students/students.service';

const SEED_SLUG = 'test-school';

/**
 * [27.6] End-to-end coverage of the whole wave-1/2 admission backend flow,
 * exercised through the real Nest providers rather than HTTP (unlike
 * `public-admission.controller.e2e-spec.ts`, which only covers the public
 * submission surface): public submit -> staff evaluate (shortlist) -> staff
 * admit -> a real Student + Guardian exist, and every step stayed inside
 * `SEED_TENANT_ID`.
 */
describe('Admission flow (integration)', () => {
  let app: TestingModule;
  let dataSource: DataSource;
  let applicantService: AdmissionApplicantService;
  let reviewService: ApplicantReviewService;

  async function createIntake(overrides: Partial<Record<string, unknown>> = {}): Promise<string> {
    const res = await dataSource.query(
      `INSERT INTO admission_intakes
         (id, tenant_id, class_section_id, title, seat_count, open_date, close_date, required_document_types, created_at, updated_at)
       VALUES (DEFAULT, $1, $2, $3, $4, $5::date, $6::date, $7::jsonb, NOW(), NOW())
       RETURNING id`,
      [
        SEED_TENANT_ID,
        SEED_SECTION_1_ID,
        (overrides.title as string) ?? 'Class 1 Admission 2026',
        (overrides.seat_count as number) ?? 2,
        (overrides.open_date as string) ?? '2026-01-01',
        (overrides.close_date as string) ?? '2099-12-31',
        JSON.stringify((overrides.required_document_types as string[]) ?? []),
      ],
    );
    return res[0].id;
  }

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL must be set to run integration tests');
    }
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';

    app = await Test.createTestingModule({ imports: [AppModule] }).compile();
    dataSource = app.get(DataSource);
    applicantService = app.get(AdmissionApplicantService);
    reviewService = app.get(ApplicantReviewService);
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await dataSource.query(`DELETE FROM admission_evaluations WHERE tenant_id = $1`, [
      SEED_TENANT_ID,
    ]);
    await dataSource.query(`DELETE FROM admission_applicants WHERE tenant_id = $1`, [
      SEED_TENANT_ID,
    ]);
    await dataSource.query(`DELETE FROM admission_intakes WHERE tenant_id = $1`, [SEED_TENANT_ID]);
  });

  it('submit -> shortlist -> admit produces a Student + Guardian, tenant-scoped throughout', async () => {
    const intakeId = await createIntake();

    // 1. Public submit — no tenant/auth context, resolved from the slug.
    const submitted = await applicantService.submit(
      SEED_SLUG,
      {
        intake_id: intakeId,
        applicant_name: 'Rahim Uddin',
        date_of_birth: '2018-05-01',
        gender: 'MALE',
        guardian_name: 'Karim Uddin',
        guardian_phone: '01700000123',
      },
      [],
    );
    expect(submitted.reference_number).toMatch(/^ADM-\d{4}-\d{6}$/);
    expect(submitted.status).toBe('PENDING');

    const [applicantRow] = await dataSource.query(
      `SELECT id, tenant_id, status FROM admission_applicants WHERE reference_number = $1`,
      [submitted.reference_number],
    );
    expect(applicantRow.tenant_id).toBe(SEED_TENANT_ID);
    const applicantId: string = applicantRow.id;

    // 2. Staff evaluate: shortlist.
    const shortlisted = await reviewService.evaluate(
      applicantId,
      { notes: 'Looks promising', decision: 'SHORTLIST' },
      SEED_TENANT_ID,
      SEED_ADMIN_USER_ID,
    );
    expect(shortlisted.status).toBe('SHORTLISTED');

    const evaluationsAfterShortlist = await dataSource.query(
      `SELECT decision, tenant_id, reviewer_user_id FROM admission_evaluations WHERE applicant_id = $1`,
      [applicantId],
    );
    expect(evaluationsAfterShortlist).toHaveLength(1);
    expect(evaluationsAfterShortlist[0].decision).toBe('SHORTLIST');
    expect(evaluationsAfterShortlist[0].tenant_id).toBe(SEED_TENANT_ID);
    expect(evaluationsAfterShortlist[0].reviewer_user_id).toBe(SEED_ADMIN_USER_ID);

    // 3. Staff admit — converts to a real Student + Guardian.
    const admitted = await reviewService.admit(
      applicantId,
      { notes: 'Welcome aboard' },
      SEED_TENANT_ID,
      SEED_ADMIN_USER_ID,
    );
    expect(admitted.status).toBe('ADMITTED');

    // A second evaluation row was appended (append-only — see
    // `admission-evaluations.tab.ts`'s file doc comment), not merged into
    // the shortlist row.
    const evaluationsAfterAdmit = await dataSource.query(
      `SELECT decision FROM admission_evaluations WHERE applicant_id = $1 ORDER BY created_at`,
      [applicantId],
    );
    expect(evaluationsAfterAdmit.map((e: { decision: string }) => e.decision)).toEqual([
      'SHORTLIST',
      'ADMIT',
    ]);

    const [guardianRow] = await dataSource.query(
      `SELECT id, tenant_id, phone FROM guardians WHERE tenant_id = $1 AND phone = $2`,
      [SEED_TENANT_ID, '01700000123'],
    );
    expect(guardianRow).toBeDefined();
    expect(guardianRow.tenant_id).toBe(SEED_TENANT_ID);

    const [studentRow] = await dataSource.query(
      `SELECT id, tenant_id, full_name, class_section_id FROM students
       WHERE tenant_id = $1 AND full_name = $2`,
      [SEED_TENANT_ID, 'Rahim Uddin'],
    );
    expect(studentRow).toBeDefined();
    expect(studentRow.tenant_id).toBe(SEED_TENANT_ID);
    expect(studentRow.class_section_id).toBe(SEED_SECTION_1_ID);

    const [guardianLink] = await dataSource.query(
      `SELECT 1 FROM student_guardians WHERE student_id = $1 AND guardian_id = $2`,
      [studentRow.id, guardianRow.id],
    );
    expect(guardianLink).toBeDefined();
  });

  it("never lets a request scoped to another tenant read or mutate this tenant's applicant", async () => {
    const intakeId = await createIntake();
    const submitted = await applicantService.submit(
      SEED_SLUG,
      {
        intake_id: intakeId,
        applicant_name: 'Fatima Begum',
        date_of_birth: '2019-01-10',
        gender: 'FEMALE',
        guardian_name: 'Nusrat Begum',
        guardian_phone: '01700000456',
      },
      [],
    );
    const [applicantRow] = await dataSource.query(
      `SELECT id FROM admission_applicants WHERE reference_number = $1`,
      [submitted.reference_number],
    );

    const otherTenantId = '00000000-0000-4000-8000-00000000dead';
    await expect(
      reviewService.evaluate(
        applicantRow.id,
        { notes: 'Wrong tenant', decision: 'SHORTLIST' },
        otherTenantId,
        SEED_ADMIN_USER_ID,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    // Untouched: no evaluation row, still PENDING.
    const evaluations = await dataSource.query(
      `SELECT 1 FROM admission_evaluations WHERE applicant_id = $1`,
      [applicantRow.id],
    );
    expect(evaluations).toHaveLength(0);
    const [stillPending] = await dataSource.query(
      `SELECT status FROM admission_applicants WHERE id = $1`,
      [applicantRow.id],
    );
    expect(stillPending.status).toBe('PENDING');
  });
});
