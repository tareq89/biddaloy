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

/** [71.G2.05] Stage results and cut-off. */
describe('Admission stage results (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let token: string;
  let intake: string;
  let stage: string;
  const people: string[] = [];
  let n = 0;

  const http = () => supertest(app.getHttpServer());
  const as = (req: supertest.Test, role: UserRole, tenantId: string | null = SEED_TENANT_ID) => {
    req.set('Authorization', `Bearer ${token}`).set('X-Role', role);
    return tenantId === null ? req : req.set('X-Tenant-ID', tenantId);
  };
  const admin = (req: supertest.Test, tenantId: string | null = SEED_TENANT_ID) =>
    as(req, UserRole.ADMIN, tenantId);
  const url = (id: string, tail: string) => `/api/v1/admission/stages/${id}/${tail}`;

  const seedApplicant = async (status = 'PENDING') => {
    n += 1;
    const [{ id }] = await ds.query(
      `INSERT INTO admission_applicants
         (tenant_id, intake_id, reference_number, applicant_name, date_of_birth, gender,
          guardian_name, guardian_phone, status)
       VALUES ($1, $2, $3, $4, '2015-01-01', 'MALE', 'G', '01711000097', $5) RETURNING id`,
      [SEED_TENANT_ID, intake, `ADM-SR-${n}`, `Result Child ${n}`, status],
    );
    return id as string;
  };
  const score = (id: string, s: number) => ({ applicant_id: id, attended: true, score: s });

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
       VALUES ($1, 'Result Other School', 'result-other-school', NOW(), NOW()) ON CONFLICT DO NOTHING`,
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
    await ds.query(`DELETE FROM admission_stage_results WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await ds.query(`DELETE FROM admission_applicants WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await ds.query(`DELETE FROM admission_stages WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await ds.query(`DELETE FROM admission_intakes WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    intake = (
      await ds.query(
        `INSERT INTO admission_intakes
           (id, tenant_id, class_section_id, title, seat_count, open_date, close_date,
            required_document_types, roll_prefix, created_at, updated_at)
         VALUES (DEFAULT, $1, $2, 'Result E2E', 5, '2026-01-01', '2099-12-31', '[]'::jsonb, 'E-', NOW(), NOW())
         RETURNING id`,
        [SEED_TENANT_ID, SEED_SECTION_1_ID],
      )
    )[0].id as string;
    stage = (
      await ds.query(
        `INSERT INTO admission_stages (tenant_id, intake_id, position, kind, config)
         VALUES ($1, $2, 1, 'WRITTEN', '{"total_marks": 100}') RETURNING id`,
        [SEED_TENANT_ID, intake],
      )
    )[0].id as string;
    people.length = 0;
    for (let i = 0; i < 3; i++) people.push(await seedApplicant());
  });

  it('ADMIN saves results; TEACHER gets 403; a bad score or unknown applicant is 400', async () => {
    const [a, b, c] = people;
    const ok = { results: [score(a, 90), score(b, 70), { applicant_id: c, attended: false }] };
    await as(http().put(url(stage, 'results')).send(ok), UserRole.TEACHER).expect(403);
    const res = await admin(http().put(url(stage, 'results')).send(ok)).expect(200);
    expect(res.body).toEqual({ saved: 3 });
    for (const bad of [
      { results: [score(a, 100.5)] },
      { results: [score(a, 1.234)] },
      { results: [{ applicant_id: a, attended: true }] },
      { results: [score('00000000-0000-4000-8000-0000000000aa', 5)] },
      { results: [] },
      { results: Array.from({ length: 201 }, () => score(a, 1)) },
    ])
      await admin(http().put(url(stage, 'results')).send(bad)).expect(400);
  });

  it('FEE_PENDING applicants are refused', async () => {
    const fp = await seedApplicant('FEE_PENDING');
    await admin(
      http()
        .put(url(stage, 'results'))
        .send({ results: [score(fp, 5)] }),
    ).expect(400);
  });

  it('preview and commit agree; a repeat commit is the same; incomplete results are 409', async () => {
    const [a, b, c] = people;
    const cut = { mode: 'TOP_N', value: 1 };
    await admin(
      http()
        .put(url(stage, 'results'))
        .send({ results: [score(a, 90)] }),
    ).expect(200);
    await admin(http().post(url(stage, 'cutoff/commit')).send(cut)).expect(409);
    await admin(
      http()
        .put(url(stage, 'results'))
        .send({ results: [score(b, 70), { applicant_id: c, attended: false }] }),
    ).expect(200);
    const preview = await admin(http().post(url(stage, 'cutoff/preview')).send(cut)).expect(200);
    expect(preview.body.passing).toEqual([a]);
    expect(preview.body.failing.sort()).toEqual([b, c].sort());
    const first = await admin(http().post(url(stage, 'cutoff/commit')).send(cut)).expect(200);
    const second = await admin(http().post(url(stage, 'cutoff/commit')).send(cut)).expect(200);
    expect(first.body).toEqual({ passed: 1, failed: 2 });
    expect(second.body).toEqual(first.body);
    await admin(
      http()
        .post(url(stage, 'cutoff/commit'))
        .send({ ...cut, add: [b], remove: [a] }),
    ).expect(200);
    const rows = await ds.query(
      `SELECT applicant_id, passed FROM admission_stage_results WHERE stage_id = $1`,
      [stage],
    );
    expect(
      rows
        .filter((r: { passed: boolean }) => r.passed)
        .map((r: { applicant_id: string }) => r.applicant_id),
    ).toEqual([b]);
    await admin(
      http().post(url(stage, 'cutoff/preview')).send({ mode: 'RANDOM', value: 1 }),
    ).expect(400);
  });

  it('a missing or invalid X-Tenant-ID is refused', async () => {
    for (const t of [null, 'not-a-uuid']) {
      for (const req of [
        admin(
          http()
            .put(url(stage, 'results'))
            .send({ results: [score(people[0], 1)] }),
          t,
        ),
        admin(http().post(url(stage, 'cutoff/preview')).send({ mode: 'TOP_N', value: 1 }), t),
        admin(http().post(url(stage, 'cutoff/commit')).send({ mode: 'TOP_N', value: 1 }), t),
      ]) {
        expect([400, 401, 403]).toContain((await req).status);
      }
    }
  });

  it('tenant B cannot read or write tenant A stage results', async () => {
    await admin(
      http()
        .put(url(stage, 'results'))
        .send({ results: [score(people[0], 5)] }),
      OTHER_TENANT_ID,
    ).expect(404);
    await admin(
      http().post(url(stage, 'cutoff/preview')).send({ mode: 'TOP_N', value: 1 }),
      OTHER_TENANT_ID,
    ).expect(404);
    await admin(
      http().post(url(stage, 'cutoff/commit')).send({ mode: 'TOP_N', value: 1 }),
      OTHER_TENANT_ID,
    ).expect(404);
    const [{ count }] = await ds.query(
      `SELECT count(*)::int AS count FROM admission_stage_results WHERE stage_id = $1`,
      [stage],
    );
    expect(count).toBe(0);
  });

  it('a non-UUID id is 400 and an unknown id is 404', async () => {
    const body = { results: [score(people[0], 5)] };
    const cut = { mode: 'TOP_N', value: 1 };
    await admin(http().put(url('nope', 'results')).send(body)).expect(400);
    await admin(http().post(url('nope', 'cutoff/preview')).send(cut)).expect(400);
    await admin(http().post(url('nope', 'cutoff/commit')).send(cut)).expect(400);
    const none = '00000000-0000-4000-8000-0000000000aa';
    await admin(http().put(url(none, 'results')).send(body)).expect(404);
  });
});
