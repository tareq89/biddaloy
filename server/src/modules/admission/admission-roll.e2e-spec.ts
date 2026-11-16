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

const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000000995';
const NO_SUCH = '00000000-0000-4000-8000-0000000000aa';

/** [71.G1.04] Roll numbers and stage schedule. */
describe('Admission rolls and schedule (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let token: string;
  let intake: string;
  let stage: string;
  let n = 0;

  const http = () => supertest(app.getHttpServer());
  const as = (req: supertest.Test, role: UserRole, tenantId: string | null = SEED_TENANT_ID) => {
    req.set('Authorization', `Bearer ${token}`).set('X-Role', role);
    return tenantId === null ? req : req.set('X-Tenant-ID', tenantId);
  };
  const admin = (req: supertest.Test, tenantId: string | null = SEED_TENANT_ID) =>
    as(req, UserRole.ADMIN, tenantId);
  const rollsUrl = (id: string) => `/api/v1/admission/intakes/${id}/rolls`;
  const schedUrl = (id: string) => `/api/v1/admission/stages/${id}/schedule`;
  const body = { date: '2099-01-02', start_time: '10:30', venue: 'Main hall' };

  const seedApplicant = async (status: string) => {
    n += 1;
    await ds.query(
      `INSERT INTO admission_applicants
         (tenant_id, intake_id, reference_number, applicant_name, date_of_birth, gender,
          guardian_name, guardian_phone, status)
       VALUES ($1, $2, $3, $4, '2015-01-01', 'MALE', 'G', '01711000097', $5)`,
      [SEED_TENANT_ID, intake, `ADM-RL-${n}`, `Roll Child ${n}`, status],
    );
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
       VALUES ($1, 'Roll Other School', 'roll-other-school', NOW(), NOW()) ON CONFLICT DO NOTHING`,
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
    await ds.query(`DELETE FROM admission_stages WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await ds.query(`DELETE FROM admission_intakes WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    intake = (
      await ds.query(
        `INSERT INTO admission_intakes
           (id, tenant_id, class_section_id, title, seat_count, open_date, close_date,
            required_document_types, roll_prefix, created_at, updated_at)
         VALUES (DEFAULT, $1, $2, 'Roll E2E', 5, '2026-01-01', '2099-12-31', '[]'::jsonb, 'E-', NOW(), NOW())
         RETURNING id`,
        [SEED_TENANT_ID, SEED_SECTION_1_ID],
      )
    )[0].id as string;
    stage = (
      await ds.query(
        `INSERT INTO admission_stages (tenant_id, intake_id, position, kind, config)
         VALUES ($1, $2, 1, 'WRITTEN', '{"pass": 40}') RETURNING id`,
        [SEED_TENANT_ID, intake],
      )
    )[0].id as string;
  });

  it('ADMIN assigns rolls to fee-confirmed only; repeat assigns none; TEACHER gets 403', async () => {
    await seedApplicant('PENDING');
    await seedApplicant('FEE_PENDING');
    await as(http().post(rollsUrl(intake)).send({ order: 'NAME' }), UserRole.TEACHER).expect(403);
    const res = await admin(http().post(rollsUrl(intake)).send({ order: 'NAME' })).expect(200);
    expect(res.body).toEqual({ assigned: 1, first_roll: 'E-0001', last_roll: 'E-0001' });
    const again = await admin(http().post(rollsUrl(intake)).send({ order: 'APPLIED_AT' })).expect(
      200,
    );
    expect(again.body.assigned).toBe(0);
  });

  it('a bad order is 400', async () => {
    await admin(http().post(rollsUrl(intake)).send({ order: 'RANDOM' })).expect(400);
    await admin(http().post(rollsUrl(intake)).send({})).expect(400);
  });

  it('schedule stores date, time and venue, keeps other config, validates input', async () => {
    await as(http().patch(schedUrl(stage)).send(body), UserRole.TEACHER).expect(403);
    const res = await admin(http().patch(schedUrl(stage)).send(body)).expect(200);
    expect(res.body).toMatchObject(body);
    const [row] = await ds.query(`SELECT config FROM admission_stages WHERE id = $1`, [stage]);
    expect(row.config).toEqual({ pass: 40, ...body });
    for (const bad of [
      { ...body, date: '2000-01-01' },
      { ...body, date: '2099-02-30' },
      { ...body, start_time: '25:00' },
      { ...body, venue: undefined },
    ])
      await admin(http().patch(schedUrl(stage)).send(bad)).expect(400);
  });

  it('a missing or invalid X-Tenant-ID is refused', async () => {
    for (const t of [null, 'not-a-uuid']) {
      for (const req of [
        admin(http().post(rollsUrl(intake)).send({ order: 'NAME' }), t),
        admin(http().patch(schedUrl(stage)).send(body), t),
      ]) {
        expect([400, 401, 403]).toContain((await req).status);
      }
    }
  });

  it('tenant B cannot number or schedule tenant A', async () => {
    await seedApplicant('PENDING');
    await admin(http().post(rollsUrl(intake)).send({ order: 'NAME' }), OTHER_TENANT_ID).expect(404);
    await admin(http().patch(schedUrl(stage)).send(body), OTHER_TENANT_ID).expect(404);
    const [row] = await ds.query(
      `SELECT roll_number FROM admission_applicants WHERE intake_id = $1`,
      [intake],
    );
    expect(row.roll_number).toBeNull();
  });

  it('a non-UUID id is 400 and an unknown id is 404', async () => {
    await admin(http().post(rollsUrl('nope')).send({ order: 'NAME' })).expect(400);
    await admin(http().patch(schedUrl('nope')).send(body)).expect(400);
    await admin(http().post(rollsUrl(NO_SUCH)).send({ order: 'NAME' })).expect(404);
    await admin(http().patch(schedUrl(NO_SUCH)).send(body)).expect(404);
  });
});
