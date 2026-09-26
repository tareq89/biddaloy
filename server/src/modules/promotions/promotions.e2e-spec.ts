import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { UserRole, PlacementAlgorithm, PromotionOutcome, PromotionRunStatus, ApprovalScope } from '@biddaloy/shared';
import { SEED_TENANT_ID, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD, SEED_ADMIN_PASSWORD_HASH } from '@test/constants';

/**
 * E2E tests for the money-tier `POST /promotions/:id/commit` boundary
 * (#788): the conditional PROMOTION_OVERRIDE approval gate, the ADMIN-only
 * role guard, and tenant isolation. The placement/merit math and the
 * commit transaction's own atomicity are covered by
 * `promotions.service.integration.spec.ts` — this file only exercises
 * what the HTTP layer is responsible for.
 */
const API = '/api/v1';
process.env.ACCOUNT_ACCESS_ECHO_SECRETS = 'true';

const APPROVER_ID = '00000000-0000-4000-8000-0000007e0001';
const APPROVER_EMAIL = 'promotions-approver@e2e.example';
const EXECUTIVE_ID = '00000000-0000-4000-8000-0000007e0002';
const EXECUTIVE_EMAIL = 'promotions-executive@e2e.example';

const OTHER_TENANT_ID = '00000000-0000-4000-8000-0000007e0099';

describe('Promotions E2E (#788)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;
  let executiveToken: string;
  let seq = 0;

  async function login(email: string): Promise<string> {
    const res = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token;
  }

  async function issueApprovalToken(scope: string, identifier: string): Promise<string> {
    const requestRes = await supertest(app.getHttpServer())
      .post(`${API}/auth/step-up/otp/request`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .send({ identifier })
      .expect(202);
    const otp = requestRes.body.debug?.otp;

    const verifyRes = await supertest(app.getHttpServer())
      .post(`${API}/auth/step-up`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .send({ identifier, method: 'OTP', otp, scope })
      .expect(200);
    return verifyRes.body.approval_token;
  }

  /** Seeds one tenant's worth of class/section/student/enrollment/run/entry rows via raw SQL — fast and deterministic. */
  async function seedRun(opts: {
    tenantId: string;
    withOverride: boolean;
  }): Promise<{ runId: string; studentId: string }> {
    seq += 1;
    // UUID's last group is 12 hex chars — pad seq to 8 so the 4-digit
    // literal suffix below always lands on exactly 12.
    const p = String(seq).padStart(8, '0');
    const yearSrcId = `00000000-0000-4000-9000-${p}0001`;
    const yearTgtId = `00000000-0000-4000-9000-${p}0002`;
    const classSrcId = `00000000-0000-4000-9000-${p}0003`;
    const sectionSrcId = `00000000-0000-4000-9000-${p}0004`;
    const classTgtId = `00000000-0000-4000-9000-${p}0005`;
    const sectionTgtId = `00000000-0000-4000-9000-${p}0006`;
    const studentId = `00000000-0000-4000-9000-${p}0007`;
    const enrollmentId = `00000000-0000-4000-9000-${p}0008`;
    const runId = `00000000-0000-4000-9000-${p}0009`;
    // D20 retain class (same grade as source) in the target year — the
    // withOverride=true case sets final_outcome=RETAIN, and resolveTarget's
    // D20 check would otherwise block every run on this source grade.
    const classRetainId = `00000000-0000-4000-9000-${p}000a`;
    const sectionRetainId = `00000000-0000-4000-9000-${p}000b`;

    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [opts.tenantId, `E2E School ${seq}`, `e2e-school-${seq}`],
    );
    // `is_current` has a partial unique index per tenant — false here since
    // seedRun() is called 2-3x per tenant across this file's tests and only
    // one academic_year per tenant may be current at a time.
    await dataSource.query(
      `INSERT INTO academic_years (id, name, start_date, end_date, is_current, tenant_id, created_at, updated_at)
       VALUES ($1, $2, '2026-01-01', '2026-12-31', false, $3, NOW(), NOW())`,
      [yearSrcId, `2026 (src ${seq})`, opts.tenantId],
    );
    await dataSource.query(
      `INSERT INTO academic_years (id, name, start_date, end_date, is_current, tenant_id, created_at, updated_at)
       VALUES ($1, $2, '2027-01-01', '2027-12-31', false, $3, NOW(), NOW())`,
      [yearTgtId, `2027 (tgt ${seq})`, opts.tenantId],
    );
    await dataSource.query(
      `INSERT INTO classes (id, name, numeric_grade, academic_year_id, tenant_id, created_at, updated_at)
       VALUES ($1, 'Source Class', 5, $2, $3, NOW(), NOW())`,
      [classSrcId, yearSrcId, opts.tenantId],
    );
    await dataSource.query(
      `INSERT INTO class_sections (id, class_id, section_name, tenant_id, created_at, updated_at)
       VALUES ($1, $2, 'A', $3, NOW(), NOW())`,
      [sectionSrcId, classSrcId, opts.tenantId],
    );
    await dataSource.query(
      `INSERT INTO classes (id, name, numeric_grade, academic_year_id, tenant_id, created_at, updated_at)
       VALUES ($1, 'Target Class', 6, $2, $3, NOW(), NOW())`,
      [classTgtId, yearTgtId, opts.tenantId],
    );
    await dataSource.query(
      `INSERT INTO class_sections (id, class_id, section_name, tenant_id, created_at, updated_at)
       VALUES ($1, $2, 'A', $3, NOW(), NOW())`,
      [sectionTgtId, classTgtId, opts.tenantId],
    );
    if (opts.withOverride) {
      await dataSource.query(
        `INSERT INTO classes (id, name, numeric_grade, academic_year_id, tenant_id, created_at, updated_at)
         VALUES ($1, 'Retained Class', 5, $2, $3, NOW(), NOW())`,
        [classRetainId, yearTgtId, opts.tenantId],
      );
      await dataSource.query(
        `INSERT INTO class_sections (id, class_id, section_name, tenant_id, created_at, updated_at)
         VALUES ($1, $2, 'A', $3, NOW(), NOW())`,
        [sectionRetainId, classRetainId, opts.tenantId],
      );
    }
    await dataSource.query(
      `INSERT INTO students (id, full_name, registration_number, roll_number, class_section_id, tenant_id, date_of_birth, preferred_communication, enrollment_status, created_at, updated_at)
       VALUES ($1, 'E2E Student', $2, 1, $3, $4, '2015-01-01', 'SMS', 'ACTIVE', NOW(), NOW())`,
      [studentId, `REG-E2E-${seq}`, sectionSrcId, opts.tenantId],
    );
    await dataSource.query(
      `INSERT INTO enrollments (id, student_id, class_id, section_id, academic_year_id, tenant_id, enrollment_status, enrolled_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', NOW(), NOW(), NOW())`,
      [enrollmentId, studentId, classSrcId, sectionSrcId, yearSrcId, opts.tenantId],
    );
    await dataSource.query(
      `INSERT INTO promotion_runs (id, tenant_id, source_class_id, source_academic_year_id, target_academic_year_id, target_class_id, exam_ids, algorithm, status, refreshed_at, override_count, created_by_user_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, '{}', $7, 'DRAFT', NOW(), $8, $9, NOW(), NOW())`,
      [
        runId,
        opts.tenantId,
        classSrcId,
        yearSrcId,
        yearTgtId,
        classTgtId,
        PlacementAlgorithm.BLOCK,
        opts.withOverride ? 1 : 0,
        APPROVER_ID,
      ],
    );
    const suggestedOutcome = PromotionOutcome.PROMOTE;
    const finalOutcome = opts.withOverride ? PromotionOutcome.RETAIN : PromotionOutcome.PROMOTE;
    await dataSource.query(
      `INSERT INTO promotion_entries (id, tenant_id, run_id, student_id, source_enrollment_id, source_section_id, merit_rank, mean_gpa, total_marks_sum, passed_all, suggested_outcome, final_outcome, is_override, override_note, overridden_by_user_id, group_name, target_class_id, target_section_id, new_roll_number, placement_error, target_enrollment_id, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 1, 4.00, 400.00, true, $6, $7, $8, $9, $10, NULL, NULL, NULL, NULL, NULL, NULL, NOW(), NOW())`,
      [
        opts.tenantId,
        runId,
        studentId,
        enrollmentId,
        sectionSrcId,
        suggestedOutcome,
        finalOutcome,
        opts.withOverride,
        opts.withOverride ? 'Manual retain — e2e' : null,
        opts.withOverride ? APPROVER_ID : null,
      ],
    );

    return { runId, studentId };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    dataSource = app.get(DataSource);

    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Promotions E2E Approver', 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [APPROVER_ID, APPROVER_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [APPROVER_ID, SEED_TENANT_ID, UserRole.ADMIN],
    );
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Promotions E2E Executive', 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [EXECUTIVE_ID, EXECUTIVE_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [EXECUTIVE_ID, SEED_TENANT_ID, UserRole.EXECUTIVE],
    );

    adminToken = await login(SEED_ADMIN_EMAIL);
    executiveToken = await login(EXECUTIVE_EMAIL);
  }, 120000);

  afterAll(async () => {
    await app.close();
  });

  it('commits a run with overrides only when a valid PROMOTION_OVERRIDE approval token is presented', async () => {
    const { runId } = await seedRun({ tenantId: SEED_TENANT_ID, withOverride: true });

    // Without a token: 403 (approval required).
    await supertest(app.getHttpServer())
      .post(`${API}/promotions/${runId}/commit`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(403);

    const token = await issueApprovalToken(ApprovalScope.PROMOTION_OVERRIDE, APPROVER_EMAIL);

    const res = await supertest(app.getHttpServer())
      .post(`${API}/promotions/${runId}/commit`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .set('X-Approval-Token', token)
      .expect(201);

    expect(res.body.status).toBe(PromotionRunStatus.COMMITTED);
  });

  it('EXECUTIVE cannot commit a run (401 — role not in @Roles(ADMIN), matching the RolesGuard convention elsewhere)', async () => {
    const { runId } = await seedRun({ tenantId: SEED_TENANT_ID, withOverride: false });

    await supertest(app.getHttpServer())
      .post(`${API}/promotions/${runId}/commit`)
      .set('Authorization', `Bearer ${executiveToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(401);
  });

  it("returns 404 for another tenant's run", async () => {
    const { runId } = await seedRun({ tenantId: OTHER_TENANT_ID, withOverride: false });

    await supertest(app.getHttpServer())
      .get(`${API}/promotions/${runId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(404);
  });
});
