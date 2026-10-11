import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import type Redis from 'ioredis';
import { PaymentMethod, UserRole } from '@biddaloy/shared';
import { AppModule } from '../../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { ensureFeeStructure, periodStart } from '@test/helpers/fee-fixture.helper';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import { BULK_IMPORT_REDIS } from '../../bulk-import/import-staging.service';
import { acquire, release } from './restore-lock';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_SECTION_1_ID,
} from '@test/constants';

const API = '/api/v1';
const JOB = 'job-freeze-e2e';
/** A tenant other than the seeded one: locking it must not affect SEED_TENANT_ID. */
const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000068102';

/** [68.1.2210] DATA-01: writes are refused (423) while a tenant's restore lock is held. */
describe('Restore freeze (DATA-01)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let redis: Redis;
  let adminToken: string;
  let structureId: string;

  async function createBill(amount = 1000): Promise<string> {
    const student = (
      await dataSource.query(
        `INSERT INTO students (id, full_name, registration_number, roll_number, class_section_id, tenant_id, date_of_birth, preferred_communication, enrollment_status, created_at, updated_at)
         VALUES (DEFAULT, 'Freeze E2E Student', 'REG-FRZ-0001', 4001, $1, $2, '2010-01-01', 'SMS', 'ACTIVE', NOW(), NOW())
         RETURNING id`,
        [SEED_SECTION_1_ID, SEED_TENANT_ID],
      )
    )[0].id;
    const yearId = (
      await dataSource.query(`SELECT id FROM academic_years WHERE tenant_id = $1 LIMIT 1`, [
        SEED_TENANT_ID,
      ])
    )[0].id;
    return (
      await dataSource.query(
        `INSERT INTO student_fees (id, student_id, academic_year_id, fee_structure_id, period_start, due_date, total_amount, paid_amount, discount_amount, status, created_at, updated_at)
         VALUES (DEFAULT, $1, $2, $3, $4::date, '2026-01-10'::date, $5, 0, 0, 'PENDING', NOW(), NOW())
         RETURNING id`,
        [student, yearId, structureId, periodStart(1, 2026), amount],
      )
    )[0].id;
  }

  const checkout = (bill: string) =>
    supertest(app.getHttpServer())
      .post(`${API}/payments/checkout`)
      .send({
        idempotency_key: randomUUID(),
        lines: [{ student_fee_id: bill, amount: 1000, one_off_discount: 0 }],
        payment_method: PaymentMethod.CASH,
      })
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .set('X-Role', UserRole.ADMIN);

  const paymentCount = async (): Promise<number> =>
    Number((await dataSource.query(`SELECT COUNT(*) AS n FROM payments`))[0].n);

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    dataSource = app.get(DataSource);
    redis = app.get<Redis>(BULK_IMPORT_REDIS);
    const login = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    adminToken = login.body.access_token;
  }, 120000);

  beforeEach(async () => {
    structureId = await ensureFeeStructure(dataSource);
  });

  afterEach(async () => {
    await release(redis, SEED_TENANT_ID, JOB);
    await release(redis, OTHER_TENANT_ID, JOB);
  });

  afterAll(async () => {
    await app.close();
  });

  it('refuses a checkout with 423 TENANT_RESTORING and writes no payment', async () => {
    const bill = await createBill();
    expect(await acquire(redis, SEED_TENANT_ID, JOB)).toBe(true);
    const before = await paymentCount();

    const res = await checkout(bill).expect(423);

    expect(res.body.details.code).toBe('TENANT_RESTORING');
    expect(await paymentCount()).toBe(before);
  });

  it('still serves reads while locked', async () => {
    await acquire(redis, SEED_TENANT_ID, JOB);
    await supertest(app.getHttpServer())
      .get(`${API}/students`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .set('X-Role', UserRole.ADMIN)
      .expect(200);
  });

  it('accepts the same checkout once the lock is released', async () => {
    const bill = await createBill();
    await acquire(redis, SEED_TENANT_ID, JOB);
    await checkout(bill).expect(423);
    await release(redis, SEED_TENANT_ID, JOB);
    await checkout(bill).expect(201);
  });

  it("does not freeze another tenant's writes", async () => {
    const bill = await createBill();
    await acquire(redis, OTHER_TENANT_ID, JOB);
    await checkout(bill).expect(201);
  });

  it('still returns 401 for a missing X-Tenant-ID (guard order unchanged)', async () => {
    await acquire(redis, SEED_TENANT_ID, JOB);
    await supertest(app.getHttpServer())
      .post(`${API}/payments/checkout`)
      .send({})
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(401);
  });
});
