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

const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000000994';
const NO_SUCH = '00000000-0000-4000-8000-0000000000aa';

/** [#4184] Publish, estimate and call list over HTTP. */
describe('Admission publication (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let token: string;
  let intake: string;
  let list: string;
  let applicant: string;
  let n = 0;

  const http = () => supertest(app.getHttpServer());
  const as = (req: supertest.Test, role: UserRole, tenantId: string | null = SEED_TENANT_ID) => {
    req.set('Authorization', `Bearer ${token}`).set('X-Role', role);
    return tenantId === null ? req : req.set('X-Tenant-ID', tenantId);
  };
  const admin = (req: supertest.Test, tenantId: string | null = SEED_TENANT_ID) =>
    as(req, UserRole.ADMIN, tenantId);
  const base = () => `/api/v1/admission/intakes/${intake}`;
  const publishBody = () => ({ what: 'MERIT', ref_id: list, send_sms: false });
  const smsLogs = async () =>
    Number(
      (
        await ds.query(
          `SELECT count(DISTINCT metadata->>'applicant_id') FROM communication_logs WHERE tenant_id = $1 AND metadata->>'admission_event' = 'RESULT'`,
          [SEED_TENANT_ID],
        )
      )[0].count,
    );

  const seedApplicant = async (status: string, onList = true) => {
    n += 1;
    const id = (
      await ds.query(
        `INSERT INTO admission_applicants
           (tenant_id, intake_id, reference_number, applicant_name, date_of_birth, gender,
            guardian_name, guardian_phone, status)
         VALUES ($1, $2, $3, $4, '2015-01-01', 'MALE', 'G', '01711000096', $5) RETURNING id`,
        [SEED_TENANT_ID, intake, `ADM-PB-${n}`, `Pub Child ${n}`, status],
      )
    )[0].id as string;
    if (onList)
      await ds.query(
        `INSERT INTO admission_list_members (tenant_id, list_id, applicant_id, position)
         VALUES ($1, $2, $3, $4)`,
        [SEED_TENANT_ID, list, id, n],
      );
    return id;
  };

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
       VALUES ($1, 'Pub Other School', 'pub-other-school', NOW(), NOW()) ON CONFLICT DO NOTHING`,
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
    await ds.query(`DELETE FROM admission_applicants WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await ds.query(`DELETE FROM admission_lists WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await ds.query(`DELETE FROM admission_intakes WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    intake = (
      await ds.query(
        `INSERT INTO admission_intakes
           (id, tenant_id, class_section_id, title, seat_count, open_date, close_date,
            required_document_types, created_at, updated_at)
         VALUES (DEFAULT, $1, $2, 'Pub E2E', 5, '2026-01-01', '2099-12-31', '[]'::jsonb, NOW(), NOW())
         RETURNING id`,
        [SEED_TENANT_ID, SEED_SECTION_1_ID],
      )
    )[0].id as string;
    list = (
      await ds.query(
        `INSERT INTO admission_lists (tenant_id, intake_id, kind, sequence, order_by, capacity)
         VALUES ($1, $2, 'MERIT', 1, 'MERIT', 5) RETURNING id`,
        [SEED_TENANT_ID, intake],
      )
    )[0].id as string;
    applicant = await seedApplicant('PENDING');
  });

  it('ADMIN publishes (flag set, one audit row); TEACHER 403; missing key 400', async () => {
    await as(
      http().post(`${base()}/publish`).set('Idempotency-Key', 'k-t').send(publishBody()),
      UserRole.TEACHER,
    ).expect(403);
    await admin(http().post(`${base()}/publish`).send(publishBody())).expect(400);
    const res = await admin(
      http().post(`${base()}/publish`).set('Idempotency-Key', 'k-1').send(publishBody()),
    ).expect(200);
    expect(res.body).toMatchObject({ already_published: false, sms_attempted: 0 });
    const [row] = await ds.query(`SELECT published_at FROM admission_lists WHERE id = $1`, [list]);
    expect(row.published_at).not.toBeNull();
    const [{ count }] = await ds.query(
      `SELECT count(*) FROM audit_logs WHERE entity_type = 'AdmissionApplicant' AND new_values->>'op' = 'publish' AND tenant_id = $1`,
      [SEED_TENANT_ID],
    );
    expect(Number(count)).toBe(1);
  });

  it('estimate equals sent; FEE_PENDING and REJECTED are left out; same key sends once', async () => {
    await seedApplicant('FEE_PENDING');
    await seedApplicant('REJECTED');
    const est = await admin(
      http().get(`${base()}/publish/estimate?what=MERIT&ref_id=${list}`),
    ).expect(200);
    expect(est.body.recipients).toBe(1);
    const send = () =>
      admin(
        http()
          .post(`${base()}/publish`)
          .set('Idempotency-Key', 'k-2')
          .send({ ...publishBody(), send_sms: true }),
      );
    const first = await send().expect(200);
    await send().expect(200);
    expect(first.body.sms_attempted).toBe(est.body.recipients);
    expect(await smsLogs()).toBe(est.body.recipients);
    await admin(
      http()
        .post(`${base()}/publish`)
        .set('Idempotency-Key', 'k-3')
        .send({ ...publishBody(), send_sms: true }),
    ).expect(200);
    expect(await smsLogs()).toBe(est.body.recipients);
  });

  it('a stage publishes into config.published_at', async () => {
    const stage = (
      await ds.query(
        `INSERT INTO admission_stages (tenant_id, intake_id, position, kind, config)
         VALUES ($1, $2, 1, 'WRITTEN', '{"pass": 40}') RETURNING id`,
        [SEED_TENANT_ID, intake],
      )
    )[0].id as string;
    await admin(
      http()
        .post(`${base()}/publish`)
        .set('Idempotency-Key', 'k-4')
        .send({ what: 'STAGE', ref_id: stage, send_sms: false }),
    ).expect(200);
    const [row] = await ds.query(`SELECT config FROM admission_stages WHERE id = $1`, [stage]);
    expect(row.config.pass).toBe(40);
    expect(typeof row.config.published_at).toBe('string');
  });

  it('call list shows name, phone, roll, called; PATCH sets and clears it', async () => {
    const url = `/api/v1/admission/call-list/${applicant}`;
    const get = () => admin(http().get(`${base()}/call-list?list_id=${list}`));
    expect((await get().expect(200)).body[0]).toMatchObject({
      applicant_id: applicant,
      phone: '01711000096',
      called: false,
    });
    await as(http().patch(url).send({ called: true }), UserRole.TEACHER).expect(403);
    await admin(
      http()
        .patch(url)
        .send({ called: true, note: 'x'.repeat(301) }),
    ).expect(400);
    await admin(http().patch(url).send({ called: true, note: 'will come' })).expect(200);
    expect((await get()).body[0]).toMatchObject({ called: true, note: 'will come' });
    await admin(http().patch(url).send({ called: false })).expect(200);
    expect((await get()).body[0]).toMatchObject({ called: false, note: null });
  });

  it('a bad intake publish_channels / tie_break value is 400', async () => {
    const body = {
      class_section_id: SEED_SECTION_1_ID,
      title: 'Bad',
      seat_count: 1,
      open_date: '2026-01-01',
      close_date: '2099-12-31',
    };
    await admin(
      http()
        .post('/api/v1/admission-intakes')
        .send({ ...body, publish_channels: ['FAX'] }),
    ).expect(400);
    await admin(
      http()
        .post('/api/v1/admission-intakes')
        .send({ ...body, tie_break: ['HEIGHT'] }),
    ).expect(400);
  });

  it('a missing or invalid X-Tenant-ID is refused', async () => {
    for (const t of [null, 'not-a-uuid']) {
      for (const req of [
        admin(http().get(`${base()}/publish/estimate?what=MERIT&ref_id=${list}`), t),
        admin(http().get(`${base()}/call-list?list_id=${list}`), t),
        admin(http().patch(`/api/v1/admission/call-list/${applicant}`).send({ called: true }), t),
      ]) {
        expect([400, 401, 403]).toContain((await req).status);
      }
    }
  });

  it('tenant B cannot publish, read or mark tenant A', async () => {
    await admin(
      http().post(`${base()}/publish`).set('Idempotency-Key', 'k-5').send(publishBody()),
      OTHER_TENANT_ID,
    ).expect(404);
    await admin(http().get(`${base()}/call-list?list_id=${list}`), OTHER_TENANT_ID).expect(404);
    await admin(
      http().patch(`/api/v1/admission/call-list/${applicant}`).send({ called: true }),
      OTHER_TENANT_ID,
    ).expect(404);
    const [row] = await ds.query(`SELECT published_at FROM admission_lists WHERE id = $1`, [list]);
    expect(row.published_at).toBeNull();
  });

  it('non-UUID ids are 400 and unknown ids 404', async () => {
    await admin(http().get(`/api/v1/admission/intakes/nope/call-list?list_id=${list}`)).expect(400);
    await admin(http().patch('/api/v1/admission/call-list/nope').send({ called: true })).expect(
      400,
    );
    await admin(
      http().patch(`/api/v1/admission/call-list/${NO_SUCH}`).send({ called: true }),
    ).expect(404);
  });
});
