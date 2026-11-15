import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { UserRole } from '@biddaloy/shared';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
  SEED_SECTION_1_ID,
} from '@test/constants';

const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000000997';
const URL = '/api/v1/admission/applicants';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);

/** [71.G1.02] `POST /admission/applicants`: a clerk enters an application for a walk-in. */
describe('Clerk create applicant (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let token: string;
  let freeRound: string;
  let feeRound: string;
  let n = 0;

  const http = () => supertest(app.getHttpServer());
  const as = (req: supertest.Test, role: UserRole, tenantId: string | null = SEED_TENANT_ID) => {
    req.set('Authorization', `Bearer ${token}`).set('X-Role', role);
    return tenantId === null ? req : req.set('X-Tenant-ID', tenantId);
  };
  /** A fresh child each call, so the duplicate guard never fires by accident. */
  const form = (req: supertest.Test, intake: string, over: Record<string, string> = {}) => {
    n += 1;
    const fields: Record<string, string> = {
      intake_id: intake,
      applicant_name: `Walk In ${n}`,
      date_of_birth: '2018-01-01',
      gender: 'MALE',
      guardian_name: 'Walk Guardian',
      guardian_phone: '01711000099',
      ...over,
    };
    for (const [k, v] of Object.entries(fields)) req.field(k, v);
    return req;
  };
  const count = async (sql = '') =>
    Number(
      (
        await ds.query(
          `SELECT COUNT(*)::int AS c FROM admission_applicants WHERE tenant_id = $1 ${sql}`,
          [SEED_TENANT_ID],
        )
      )[0].c,
    );

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    ds = app.get(DataSource);

    await ds.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Clerk Other School', 'clerk-other-school', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [OTHER_TENANT_ID],
    );
    for (const [tenant, role] of [
      [SEED_TENANT_ID, UserRole.TEACHER],
      [OTHER_TENANT_ID, UserRole.ADMIN],
    ]) {
      await ds.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [SEED_ADMIN_USER_ID, tenant, role],
      );
    }
    const login = await http()
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    token = login.body.access_token;
  }, 60000);

  afterAll(async () => {
    await ds.query(`DELETE FROM user_tenants WHERE tenant_id = $1`, [OTHER_TENANT_ID]);
    await app.close();
  });

  beforeEach(async () => {
    await ds.query(`DELETE FROM admission_fee_proofs WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await ds.query(`DELETE FROM admission_applicants WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await ds.query(`DELETE FROM admission_intakes WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    const mk = async (fee: number | null) =>
      (
        await ds.query(
          `INSERT INTO admission_intakes
             (id, tenant_id, class_section_id, title, seat_count, open_date, close_date,
              required_document_types, fee_amount_paisa, created_at, updated_at)
           VALUES (DEFAULT, $1, $2, 'Clerk E2E', 5, '2026-01-01', '2099-12-31', '[]'::jsonb, $3, NOW(), NOW())
           RETURNING id`,
          [SEED_TENANT_ID, SEED_SECTION_1_ID, fee],
        )
      )[0].id as string;
    freeRound = await mk(null);
    feeRound = await mk(50000);
  });

  it('ADMIN creates a CLERK application on a free round (201), TEACHER gets 403', async () => {
    const res = await form(as(http().post(URL), UserRole.ADMIN), freeRound).expect(201);
    expect(res.body.status).toBe('PENDING');
    const [row] = await ds.query(
      `SELECT source, fee_state FROM admission_applicants WHERE reference_number = $1`,
      [res.body.reference_number],
    );
    expect(row).toEqual({ source: 'CLERK', fee_state: 'NONE' });
    await form(as(http().post(URL), UserRole.TEACHER), freeRound).expect(403);
    expect(await count()).toBe(1);
  });

  it('a missing or invalid X-Tenant-ID is refused', async () => {
    for (const t of [null, 'not-a-uuid']) {
      const res = await form(as(http().post(URL), UserRole.ADMIN, t), freeRound);
      expect([400, 401, 403]).toContain(res.status);
    }
    expect(await count()).toBe(0);
  });

  it("tenant B cannot create into tenant A's round", async () => {
    const res = await form(as(http().post(URL), UserRole.ADMIN, OTHER_TENANT_ID), freeRound);
    expect(res.status).toBe(404);
    expect(await count()).toBe(0);
  });

  it('a fee round takes method plus proof file and waits in FEE_PENDING; repeat reference warns', async () => {
    const send = () =>
      form(as(http().post(URL), UserRole.ADMIN), feeRound, {
        fee_method: 'BKASH',
        fee_reference: 'TX-777',
      })
        .attach('fee_proof', JPEG, { filename: 'p.jpg', contentType: 'image/jpeg' })
        .expect(201);
    const first = await send();
    expect(first.body.status).toBe('FEE_PENDING');
    expect(first.body.warnings).toBeUndefined();
    const second = await send();
    expect(second.body.warnings).toEqual(['REFERENCE_SEEN']);
    const proofs = await ds.query(`SELECT state FROM admission_fee_proofs WHERE tenant_id = $1`, [
      SEED_TENANT_ID,
    ]);
    expect(proofs).toEqual([{ state: 'AWAITING' }, { state: 'AWAITING' }]);
    expect(await count(`AND fee_state = 'AWAITING'`)).toBe(2);
  });

  it('a fee round without a proof file is a 400 and stores nothing', async () => {
    await form(as(http().post(URL), UserRole.ADMIN), feeRound, { fee_method: 'BKASH' }).expect(400);
    expect(await count()).toBe(0);
  });

  it('bytes that do not match the declared type give 400 and store nothing', async () => {
    await form(as(http().post(URL), UserRole.ADMIN), feeRound, { fee_method: 'BKASH' })
      .attach('fee_proof', Buffer.from('<html>not an image</html>'), {
        filename: 'p.jpg',
        contentType: 'image/jpeg',
      })
      .expect(400);
    expect(await count()).toBe(0);
    const proofs = await ds.query(`SELECT 1 FROM admission_fee_proofs WHERE tenant_id = $1`, [
      SEED_TENANT_ID,
    ]);
    expect(proofs).toHaveLength(0);
  });

  it('the same Idempotency-Key twice creates one row', async () => {
    const key = `clerk-${Date.now()}`;
    const send = () => {
      const req = as(http().post(URL), UserRole.ADMIN).set('Idempotency-Key', key);
      return form(req, freeRound, { applicant_name: 'Idem Child' });
    };
    const a = await send().expect(201);
    const b = await send().expect(201);
    expect(b.body.reference_number).toBe(a.body.reference_number);
    expect(await count()).toBe(1);
  });
});
