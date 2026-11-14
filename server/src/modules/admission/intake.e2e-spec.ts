import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { UserRole, ADMISSION_TEMPLATES, AdmissionTemplateKey } from '@biddaloy/shared';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
  SEED_CLASS_1_ID,
  SEED_ACADEMIC_YEAR_ID,
} from '@test/constants';

const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000000997';
const BASE = '/api/v1/admission-intakes';

/** [Epic 71 4172] Rounds + stages over HTTP: closed by default, tenant-scoped, no echo. */
describe('IntakeController rounds and stages (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let token: string;

  const http = () => supertest(app.getHttpServer());
  const as = (req: supertest.Test, role: UserRole, tenantId: string | null = SEED_TENANT_ID) => {
    req.set('Authorization', `Bearer ${token}`).set('X-Role', role);
    return tenantId === null ? req : req.set('X-Tenant-ID', tenantId);
  };
  const body = (over: Record<string, unknown> = {}) => ({
    title: 'Round E2E',
    class_id: SEED_CLASS_1_ID,
    seat_count: 10,
    open_date: '2026-01-01',
    close_date: '2099-12-31',
    required_document_types: [],
    ...over,
  });

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
       VALUES ($1, 'Round Other School', 'round-other-school', NOW(), NOW()) ON CONFLICT DO NOTHING`,
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
    await ds.query(`DELETE FROM admission_stages WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await ds.query(`DELETE FROM admission_applicants WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await ds.query(`DELETE FROM admission_intakes WHERE tenant_id = $1`, [SEED_TENANT_ID]);
  });

  const createRound = async (over: Record<string, unknown> = {}) =>
    (await as(http().post(BASE), UserRole.ADMIN).send(body(over)).expect(201)).body;

  it('a missing X-Tenant-ID is refused', async () => {
    const res = await as(http().get(BASE), UserRole.ADMIN, null);
    expect([400, 401, 403]).toContain(res.status);
  });

  it('an invalid X-Tenant-ID is refused', async () => {
    const res = await as(http().get(BASE), UserRole.ADMIN, 'not-a-uuid');
    expect([400, 401, 403]).toContain(res.status);
  });

  it('ADMIN passes, TEACHER gets 403, on a round and on its stages', async () => {
    const round = await createRound();
    await as(http().get(BASE), UserRole.ADMIN).expect(200);
    await as(http().get(`${BASE}/${round.id}/stages`), UserRole.ADMIN).expect(200);
    await as(http().get(BASE), UserRole.TEACHER).expect(403);
    await as(http().post(`${BASE}/${round.id}/stages`), UserRole.TEACHER)
      .send({ kind: 'VIVA' })
      .expect(403);
  });

  it('a non-UUID id is a 400, never a 500', async () => {
    await as(http().get(`${BASE}/nope/stages`), UserRole.ADMIN).expect(400);
    const round = await createRound();
    await as(http().patch(`${BASE}/${round.id}/stages/nope`), UserRole.ADMIN)
      .send({ title: 'x' })
      .expect(400);
  });

  it('tenant B cannot read or change tenant A round or stages (404)', async () => {
    const round = await createRound();
    const [stage] = (await as(http().get(`${BASE}/${round.id}/stages`), UserRole.ADMIN)).body;
    await as(http().get(`${BASE}/${round.id}`), UserRole.ADMIN, OTHER_TENANT_ID).expect(404);
    await as(http().get(`${BASE}/${round.id}/stages`), UserRole.ADMIN, OTHER_TENANT_ID).expect(404);
    await as(http().post(`${BASE}/${round.id}/stages`), UserRole.ADMIN, OTHER_TENANT_ID)
      .send({ kind: 'VIVA' })
      .expect(404);
    await as(
      http().delete(`${BASE}/${round.id}/stages/${stage.id}`),
      UserRole.ADMIN,
      OTHER_TENANT_ID,
    ).expect(404);
  });

  it.each(Object.values(AdmissionTemplateKey))('template %s creates its stages', async (key) => {
    const round = await createRound({ template_key: key });
    const stages = (await as(http().get(`${BASE}/${round.id}/stages`), UserRole.ADMIN).expect(200))
      .body;
    expect(stages.map((s: { kind: string }) => s.kind)).toEqual(
      ADMISSION_TEMPLATES[key].stages.map((s) => s.kind),
    );
    expect(round.form_fields).toEqual(ADMISSION_TEMPLATES[key].fields);
  });

  it('a bad form field key is a 400 that does not echo it', async () => {
    const res = await as(http().post(BASE), UserRole.ADMIN)
      .send(body({ form_fields: ['name', 'zz_secret_probe'] }))
      .expect(400);
    expect(JSON.stringify(res.body)).not.toContain('zz_secret_probe');
  });

  it('fee above MONEY_MAX in paisa is a 400', async () => {
    await as(http().post(BASE), UserRole.ADMIN)
      .send(body({ fee_amount_paisa: 10_000_000_000 }))
      .expect(400);
  });

  it('list keeps the old fields and adds stage_count and status_counts', async () => {
    await createRound({ template_key: 'WRITTEN_VIVA' });
    const [row] = (await as(http().get(BASE), UserRole.ADMIN).expect(200)).body;
    expect(row).toMatchObject({ status: 'OPEN', stage_count: 2, status_counts: {} });
    expect(row.class_name).toBeTruthy();
    expect(row).toHaveProperty('section_name');
  });

  it('stage create appends, update edits, delete removes; a stage with results is a 409', async () => {
    const round = await createRound();
    const added = (
      await as(http().post(`${BASE}/${round.id}/stages`), UserRole.ADMIN)
        .send({ kind: 'VIVA', title: 'Viva' })
        .expect(201)
    ).body;
    expect(added.position).toBe(2);
    await as(http().patch(`${BASE}/${round.id}/stages/${added.id}`), UserRole.ADMIN)
      .send({ title: 'Viva 2' })
      .expect(200);

    const [applicant] = await ds.query(
      `INSERT INTO admission_applicants
         (id, tenant_id, intake_id, reference_number, applicant_name, date_of_birth, gender, guardian_name, guardian_phone, documents, status, created_at, updated_at)
       VALUES (DEFAULT, $1, $2, 'ADM-2026-RND001', 'Round Child', '2018-01-01', 'MALE', 'G', '8801700000997', '[]'::jsonb, 'PENDING', NOW(), NOW())
       RETURNING id`,
      [SEED_TENANT_ID, round.id],
    );
    await ds.query(
      `INSERT INTO admission_stage_results (id, tenant_id, stage_id, applicant_id, created_at, updated_at)
       VALUES (DEFAULT, $1, $2, $3, NOW(), NOW())`,
      [SEED_TENANT_ID, added.id, applicant.id],
    );
    const res = await as(
      http().delete(`${BASE}/${round.id}/stages/${added.id}`),
      UserRole.ADMIN,
    ).expect(409);
    expect(res.body.details.code).toBe('ADMISSION_STAGE_HAS_RESULTS');

    await ds.query(`DELETE FROM admission_stage_results WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await as(http().delete(`${BASE}/${round.id}/stages/${added.id}`), UserRole.ADMIN).expect(204);
  });

  it('a round in a closed year is a 409 on create (ACADEMIC_YEAR_CLOSED)', async () => {
    const [year] = await ds.query(`SELECT is_current FROM academic_years WHERE id = $1`, [
      SEED_ACADEMIC_YEAR_ID,
    ]);
    await ds.query(
      `UPDATE academic_years SET closed_at = NOW(), is_current = false WHERE id = $1`,
      [SEED_ACADEMIC_YEAR_ID],
    );
    try {
      const res = await as(http().post(BASE), UserRole.ADMIN).send(body()).expect(409);
      expect(res.body.details.code).toBe('ACADEMIC_YEAR_CLOSED');
    } finally {
      await ds.query(`UPDATE academic_years SET closed_at = NULL, is_current = $2 WHERE id = $1`, [
        SEED_ACADEMIC_YEAR_ID,
        year.is_current,
      ]);
    }
  });
});
