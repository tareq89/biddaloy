import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from './validation-pipe';
import { DataSource } from 'typeorm';
import { UserRole, CommunicationMedium } from '@biddaloy/shared';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
  SEED_SECTION_1_ID,
  SEED_CLASS_1_ID,
  SEED_ACADEMIC_YEAR_ID,
} from '@test/constants';

/**
 * Cross-tenant regression coverage (#31), item 2. The existing per-module
 * "tenant isolation" tests (students.e2e-spec.ts and others) only prove
 * that ContextGuard rejects a caller with *no membership at all* in the
 * target tenant — a 401 at the guard layer. They never prove that a
 * genuine member of tenant B is blocked, at the *service* layer, from
 * reading a resource that belongs to tenant A. A newly-added module that
 * forgets its own `tenant_id` filter would sail past every one of those
 * existing tests and still fail here.
 *
 * One token, two real tenant memberships (both ADMIN) — so ContextGuard
 * passes for both tenants, and any rejection below can only come from the
 * service layer's own tenant scoping, not the guard stack.
 */
describe('Cross-tenant access (regression)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;

  const TENANT_A = SEED_TENANT_ID;
  const TENANT_B = '00000000-0000-4000-8000-000000000199';
  const SUPER_ADMIN_USER_ID = '00000000-0000-4000-8000-000000000198';
  const SUPER_ADMIN_EMAIL = 'super-admin@cross-tenant-test.example';
  let superAdminToken: string;

  // Tracked so afterAll can remove exactly what this file created, in FK
  // dependency order — invoices reference students, so they go first.
  let createdStudentId: string | undefined;
  let createdFeeStructureId: string | undefined;
  let createdInvoiceId: string | undefined;
  let createdCommunicationId: string | undefined;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();

    dataSource = app.get(DataSource);

    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ('${TENANT_B}', 'Cross-Tenant Test School', 'cross-tenant-test-school', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
    );
    // A genuine second membership for the same user — unlike the shallower
    // existing tests, this caller really does belong to tenant B.
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ('${SEED_ADMIN_USER_ID}', '${TENANT_B}', '${UserRole.ADMIN}', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
    );

    // A real SUPER_ADMIN, membership in tenant B only — #8.7.9's schools/
    // settings endpoints are the one place in the codebase where a
    // SUPER_ADMIN must reach a *different* school than any tenant they
    // hold a membership in (ContextGuard has no synthetic "member of every
    // tenant" shortcut for the role — ContextGuard.spec.ts's own tests
    // confirm it still requires a real `user_tenants` row). Reusing
    // SEED_ADMIN_PASSWORD_HASH so this account logs in with the same
    // known password as every other seeded user.
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ('${SUPER_ADMIN_USER_ID}', '${SUPER_ADMIN_EMAIL}', '${SEED_ADMIN_PASSWORD_HASH}', 'Cross Tenant Super Admin', 'ACTIVE', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ('${SUPER_ADMIN_USER_ID}', '${TENANT_B}', '${UserRole.SUPER_ADMIN}', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
    );

    const loginRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    token = loginRes.body.access_token;

    const superAdminLoginRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SUPER_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    superAdminToken = superAdminLoginRes.body.access_token;
  }, 60000);

  afterAll(async () => {
    // FK dependency order: invoices reference students, so they're removed
    // first. communication_logs and fee_structures are independent of the
    // others created here.
    if (createdInvoiceId) {
      await dataSource.query(`DELETE FROM invoices WHERE id = '${createdInvoiceId}'`);
    }
    if (createdCommunicationId) {
      await dataSource.query(
        `DELETE FROM communication_logs WHERE id = '${createdCommunicationId}'`,
      );
    }
    if (createdFeeStructureId) {
      await dataSource.query(`DELETE FROM fee_structures WHERE id = '${createdFeeStructureId}'`);
    }
    if (createdStudentId) {
      await dataSource.query(`DELETE FROM students WHERE id = '${createdStudentId}'`);
    }

    await app.close();
  });

  it('rejects a genuine tenant-B member reading tenant-A students, fee structures, invoices, and communications', async () => {
    // --- Create every resource in tenant A ---
    const studentRes = await supertest(app.getHttpServer())
      .post('/api/v1/students')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', TENANT_A)
      .send({
        full_name: 'Cross Tenant Student',
        class_section_id: SEED_SECTION_1_ID,
        date_of_birth: '2012-01-01',
      })
      .expect(201);
    const studentId = studentRes.body.id;
    createdStudentId = studentId;

    const feeStructureRes = await supertest(app.getHttpServer())
      .post('/api/v1/fee-structures')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', TENANT_A)
      .send({
        fee_type: 'MONTHLY_TUITION',
        name: 'Cross Tenant Fee',
        amount: 500,
        class_id: SEED_CLASS_1_ID,
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
        month: 1,
      })
      .expect(201);
    const feeStructureId = feeStructureRes.body.id;
    createdFeeStructureId = feeStructureId;

    const invoiceRes = await supertest(app.getHttpServer())
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', TENANT_A)
      .send({
        student_id: studentId,
        line_items: [{ description: 'Cross tenant invoice line', amount: 500, quantity: 1 }],
      })
      .expect(201);
    const invoiceId = invoiceRes.body.id;
    createdInvoiceId = invoiceId;

    const communicationRes = await supertest(app.getHttpServer())
      .post('/api/v1/communications/send')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', TENANT_A)
      .send({
        medium: CommunicationMedium.SMS,
        recipient_address: '01712345678',
        recipient_name: 'Cross Tenant Guardian',
        message_body: 'Cross tenant test message',
      })
      .expect(201);
    const communicationId = communicationRes.body.id;
    createdCommunicationId = communicationId;

    // --- Read every one of them back from tenant B — all must 404 ---
    const crossTenantChecks: Array<{ label: string; path: string }> = [
      { label: 'student', path: `/api/v1/students/${studentId}` },
      { label: 'fee structure', path: `/api/v1/fee-structures/${feeStructureId}` },
      { label: 'invoice', path: `/api/v1/invoices/${invoiceId}` },
      { label: 'communication log', path: `/api/v1/communications/${communicationId}` },
    ];

    for (const { label, path } of crossTenantChecks) {
      const res = await supertest(app.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_B)
        .expect(404);

      expect(res.body.statusCode, `${label} should 404 for a real tenant-B member`).toBe(404);
    }

    // --- Sanity: the same caller reading from tenant A (where the
    // resources actually live) still succeeds — proves the 404s above are
    // tenant scoping, not a broken caller/permission setup entirely.
    for (const { path } of crossTenantChecks) {
      await supertest(app.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_A)
        .expect(200);
    }
  });

  /**
   * #8.7.9's schools/settings endpoints don't fit the pattern above —
   * `:id` in the URL *is* the target tenant, not a resource scoped *by*
   * one, so there's no `tenant_id` column for a forgotten filter to slip
   * past. The check here is the controller's own explicit
   * `assertCanManageSchool`, and per the issue's own acceptance criteria
   * it's a 403, not this file's usual cross-tenant 404 — see
   * `schools.controller.ts`'s comment on why that's deliberate.
   */
  it('rejects a genuine tenant-B admin reading or writing tenant-A school settings', async () => {
    await supertest(app.getHttpServer())
      .get(`/api/v1/schools/${TENANT_A}/settings`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', TENANT_B)
      .expect(403);

    await supertest(app.getHttpServer())
      .patch(`/api/v1/schools/${TENANT_A}/settings`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', TENANT_B)
      .send({ version: 1 })
      .expect(403);

    // Sanity: the same admin against their own tenant (A) succeeds —
    // proves the 403s above are the tenant check, not a broken caller.
    await supertest(app.getHttpServer())
      .get(`/api/v1/schools/${TENANT_A}/settings`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', TENANT_A)
      .expect(200);
  });

  it('lets a super admin read and write a school outside every tenant they hold a membership in', async () => {
    // superAdminToken's only real membership is tenant B (see beforeAll) —
    // reading/writing tenant A here only works via the role bypass.
    const getRes = await supertest(app.getHttpServer())
      .get(`/api/v1/schools/${TENANT_A}/settings`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .set('X-Tenant-ID', TENANT_B)
      .expect(200);
    expect(getRes.body.version).toBe(1);

    const patchRes = await supertest(app.getHttpServer())
      .patch(`/api/v1/schools/${TENANT_A}/settings`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .set('X-Tenant-ID', TENANT_B)
      .send({
        version: 1,
        communications: {
          whatsapp: {
            phoneNumberId: 'cross-tenant-phone-id',
            accessToken: 'cross-tenant-secret-token',
          },
        },
      })
      .expect(200);

    // Write-only: the response never carries the plaintext back, only a
    // masked hint — #8.7.9's central contract.
    const whatsapp = patchRes.body.communications.whatsapp;
    expect(whatsapp.phoneNumberId).toBe('cross-tenant-phone-id');
    expect(whatsapp.accessToken).toEqual({ configured: true, hint: '••••oken' });
    expect(JSON.stringify(patchRes.body)).not.toContain('cross-tenant-secret-token');
  });
});
