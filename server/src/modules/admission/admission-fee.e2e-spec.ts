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
import { StorageService } from '../storage/storage.service';
import { tenantObjectKey } from '../storage/storage-key';

const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000000996';
const URL = '/api/v1/admission/fee-proofs';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
const NO_SUCH = '00000000-0000-4000-8000-0000000000aa';

/** [71.G1.03] Fee proof list, attachment, confirm and send-back. */
describe('Admission fee verification (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let token: string;
  let intake: string;
  let n = 0;

  const http = () => supertest(app.getHttpServer());
  const as = (req: supertest.Test, role: UserRole, tenantId: string | null = SEED_TENANT_ID) => {
    req.set('Authorization', `Bearer ${token}`).set('X-Role', role);
    return tenantId === null ? req : req.set('X-Tenant-ID', tenantId);
  };
  const admin = (req: supertest.Test, tenantId: string | null = SEED_TENANT_ID) =>
    as(req, UserRole.ADMIN, tenantId);

  /** A fee-pending applicant with one AWAITING proof whose file is really stored. */
  const seedProof = async (reference: string | null = null) => {
    n += 1;
    const key = tenantObjectKey(SEED_TENANT_ID, 'admission-fee-proofs', 'jpg');
    await app.get(StorageService).put(key, JPEG, 'image/jpeg');
    const [a] = await ds.query(
      `INSERT INTO admission_applicants
         (tenant_id, intake_id, reference_number, applicant_name, date_of_birth, gender,
          guardian_name, guardian_phone, status, fee_state)
       VALUES ($1, $2, $3, $4, '2015-01-01', 'MALE', 'G', '01711000098', 'FEE_PENDING', 'AWAITING')
       RETURNING id`,
      [SEED_TENANT_ID, intake, `ADM-FE-${n}`, `Fee Child ${n}`],
    );
    const [p] = await ds.query(
      `INSERT INTO admission_fee_proofs (tenant_id, applicant_id, attachment_key, method, reference)
       VALUES ($1, $2, $3, 'BKASH', $4) RETURNING id`,
      [SEED_TENANT_ID, a.id, key, reference],
    );
    return { proof: p.id as string, applicant: a.id as string };
  };
  const applicantRow = async (id: string) =>
    (await ds.query(`SELECT status, fee_state FROM admission_applicants WHERE id = $1`, [id]))[0];
  const auditCount = async (applicant: string) =>
    Number(
      (
        await ds.query(
          `SELECT COUNT(*)::int AS c FROM audit_logs WHERE entity_type = 'AdmissionApplicant' AND entity_id = $1 AND tenant_id = $2`,
          [applicant, SEED_TENANT_ID],
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
       VALUES ($1, 'Fee Other School', 'fee-other-school', NOW(), NOW()) ON CONFLICT DO NOTHING`,
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
    intake = (
      await ds.query(
        `INSERT INTO admission_intakes
           (id, tenant_id, class_section_id, title, seat_count, open_date, close_date,
            required_document_types, fee_amount_paisa, created_at, updated_at)
         VALUES (DEFAULT, $1, $2, 'Fee E2E', 5, '2026-01-01', '2099-12-31', '[]'::jsonb, 50000, NOW(), NOW())
         RETURNING id`,
        [SEED_TENANT_ID, SEED_SECTION_1_ID],
      )
    )[0].id as string;
  });

  it('ADMIN lists awaiting proofs with seen_before; TEACHER gets 403', async () => {
    await seedProof('TX-1');
    await seedProof('TX-1');
    await seedProof(null);
    const res = await admin(http().get(URL)).expect(200);
    expect(res.body.total).toBe(3);
    expect(res.body.data.map((r: { seen_before: number }) => r.seen_before).sort()).toEqual([
      0, 1, 1,
    ]);
    await as(http().get(URL), UserRole.TEACHER).expect(403);
  });

  it('[#4253] amount_paisa is the round fee; applicantId lists that applicant in every state', async () => {
    const one = await seedProof('TX-A');
    await seedProof('TX-B');
    await ds.query(`UPDATE admission_fee_proofs SET state = 'SENT_BACK' WHERE id = $1`, [
      one.proof,
    ]);
    const all = await admin(http().get(URL)).expect(200);
    expect(all.body.total).toBe(1);
    expect(all.body.data[0].amount_paisa).toBe(50000);
    const mine = await admin(http().get(`${URL}?applicantId=${one.applicant}`)).expect(200);
    expect(mine.body.total).toBe(1);
    expect(mine.body.data[0]).toMatchObject({ applicant_id: one.applicant, state: 'SENT_BACK' });
    const none = await admin(
      http().get(`${URL}?applicantId=${one.applicant}&state=AWAITING`),
    ).expect(200);
    expect(none.body.total).toBe(0);
    await admin(http().get(`${URL}?applicantId=nope`)).expect(400);
    const other = await admin(
      http().get(`${URL}?applicantId=${one.applicant}`),
      OTHER_TENANT_ID,
    ).expect(200);
    expect(other.body.total).toBe(0);
    await ds.query(`UPDATE admission_intakes SET fee_amount_paisa = NULL WHERE id = $1`, [intake]);
    const free = await admin(http().get(`${URL}?applicantId=${one.applicant}`)).expect(200);
    expect(free.body.data[0].amount_paisa).toBeNull();
  });

  it('limit over 100 is a 400; a bad state is a 400', async () => {
    await admin(http().get(`${URL}?limit=101`)).expect(400);
    await admin(http().get(`${URL}?state=NOPE`)).expect(400);
  });

  it('a missing or invalid X-Tenant-ID is refused', async () => {
    const { proof } = await seedProof();
    for (const t of [null, 'not-a-uuid']) {
      for (const req of [
        admin(http().get(URL), t),
        admin(http().post(`${URL}/${proof}/confirm`), t),
        admin(http().post(`${URL}/${proof}/send-back`).send({ reason: 'x' }), t),
      ]) {
        expect([400, 401, 403]).toContain((await req).status);
      }
    }
  });

  it("tenant B sees none of tenant A's proofs and cannot decide or read them", async () => {
    const { proof, applicant } = await seedProof();
    const list = await admin(http().get(URL), OTHER_TENANT_ID).expect(200);
    expect(list.body.total).toBe(0);
    await admin(http().get(`${URL}/${proof}/attachment`), OTHER_TENANT_ID).expect(404);
    await admin(http().post(`${URL}/${proof}/confirm`), OTHER_TENANT_ID).expect(404);
    await admin(
      http().post(`${URL}/${proof}/send-back`).send({ reason: 'x' }),
      OTHER_TENANT_ID,
    ).expect(404);
    expect(await applicantRow(applicant)).toEqual({ status: 'FEE_PENDING', fee_state: 'AWAITING' });
  });

  it('a non-UUID id is 400 on every id route', async () => {
    await admin(http().get(`${URL}/nope/attachment`)).expect(400);
    await admin(http().post(`${URL}/nope/confirm`)).expect(400);
    await admin(http().post(`${URL}/nope/send-back`).send({ reason: 'x' })).expect(400);
    await admin(http().post(`${URL}/${NO_SUCH}/confirm`)).expect(404);
  });

  it('attachment streams the stored file with no-store', async () => {
    const { proof } = await seedProof();
    const res = await admin(http().get(`${URL}/${proof}/attachment`)).expect(200);
    expect(res.headers['content-type']).toContain('image/jpeg');
    expect(res.headers['cache-control']).toContain('no-store');
  });

  it('confirm moves the applicant to PENDING, audits once, and a repeat is 409', async () => {
    const { proof, applicant } = await seedProof();
    await as(http().post(`${URL}/${proof}/confirm`), UserRole.TEACHER).expect(403);
    const res = await admin(http().post(`${URL}/${proof}/confirm`)).expect(200);
    expect(res.body).toMatchObject({ fee_state: 'CONFIRMED', status: 'PENDING' });
    expect(await applicantRow(applicant)).toEqual({ status: 'PENDING', fee_state: 'CONFIRMED' });
    expect(await auditCount(applicant)).toBe(1);
    await admin(http().post(`${URL}/${proof}/confirm`)).expect(409);
    expect(await auditCount(applicant)).toBe(1);
  });

  it('send-back needs a reason (max 300), keeps FEE_PENDING, audits, and cannot be confirmed after', async () => {
    const { proof, applicant } = await seedProof();
    await admin(http().post(`${URL}/${proof}/send-back`).send({})).expect(400);
    await admin(http().post(`${URL}/${proof}/send-back`).send({ reason: '' })).expect(400);
    await admin(
      http()
        .post(`${URL}/${proof}/send-back`)
        .send({ reason: 'x'.repeat(301) }),
    ).expect(400);
    await admin(http().post(`${URL}/${proof}/send-back`).send({ reason: 'Blurry' })).expect(200);
    expect(await applicantRow(applicant)).toEqual({
      status: 'FEE_PENDING',
      fee_state: 'SENT_BACK',
    });
    const [row] = await ds.query(`SELECT state, reason FROM admission_fee_proofs WHERE id = $1`, [
      proof,
    ]);
    expect(row).toEqual({ state: 'SENT_BACK', reason: 'Blurry' });
    expect(await auditCount(applicant)).toBe(1);
    await admin(http().post(`${URL}/${proof}/confirm`)).expect(409);
  });

  it('the same Idempotency-Key on send-back replays one answer', async () => {
    const { proof, applicant } = await seedProof();
    const key = `fee-${Date.now()}`;
    const send = () =>
      admin(
        http().post(`${URL}/${proof}/send-back`).set('Idempotency-Key', key).send({ reason: 'R' }),
      );
    await send().expect(200);
    await send().expect(200);
    expect(await auditCount(applicant)).toBe(1);
  });
});
