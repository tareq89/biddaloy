import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from './validation-pipe';
import { DataSource } from 'typeorm';
import { UserRole, CommunicationMedium } from '@beton-boi/shared';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
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

    const loginRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    token = loginRes.body.access_token;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  it('rejects a genuine tenant-B member reading tenant-A students, fee structures, invoices, and communications', async () => {
    // --- Create every resource in tenant A ---
    const studentRes = await supertest(app.getHttpServer())
      .post('/api/v1/students')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', TENANT_A)
      .send({ full_name: 'Cross Tenant Student', class_section_id: SEED_SECTION_1_ID, date_of_birth: '2012-01-01' })
      .expect(201);
    const studentId = studentRes.body.id;

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
});
