import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
} from '@test/constants';

const API = '/api/v1';
const OTHER_TENANT_ID = '00000000-0000-4000-8000-0000000c7741';
const TENANT_ID = SEED_TENANT_ID;

/** [77.4.1] `/institution-kinds` list, preview and apply. */
describe('Institution kinds (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;

  const call = (
    method: 'get' | 'post',
    path: string,
    opts: { tenant?: string | null; role?: UserRole } = {},
  ) => {
    const req = supertest(app.getHttpServer())
      [method](`${API}/institution-kinds${path}`)
      .set('Authorization', `Bearer ${token}`);
    const tenant = opts.tenant === undefined ? TENANT_ID : opts.tenant;
    if (tenant !== null) req.set('X-Tenant-ID', tenant);
    if (opts.role) req.set('X-Role', opts.role);
    return req;
  };
  const stored = async (tenant: string) =>
    (await dataSource.query(`SELECT settings FROM schools WHERE id = $1`, [tenant]))[0].settings ??
    {};
  const reset = () =>
    dataSource.query(
      `UPDATE schools SET settings = settings - 'modules' - 'labels' WHERE id = ANY($1)`,
      [[TENANT_ID, OTHER_TENANT_ID]],
    );
  const audits = (action: string, tenant = TENANT_ID) =>
    dataSource.query(
      `SELECT old_values, new_values FROM audit_logs WHERE action = $1 AND tenant_id = $2`,
      [action, tenant],
    );

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
       VALUES ($1, 'Other Kinds School', 'other-kinds-school', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [OTHER_TENANT_ID],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [SEED_ADMIN_USER_ID, OTHER_TENANT_ID, UserRole.ADMIN],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [SEED_ADMIN_USER_ID, TENANT_ID, UserRole.TEACHER],
    );
    const login = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    token = login.body.access_token;
    await reset();
  }, 60000);

  afterAll(async () => {
    await reset();
    await dataSource.query(
      `DELETE FROM user_tenants WHERE user_id = $1 AND tenant_id = $2 AND role = $3`,
      [SEED_ADMIN_USER_ID, TENANT_ID, UserRole.TEACHER],
    );
    await app.close();
  });

  it('ADMIN lists the eight kinds', async () => {
    const res = await call('get', '').expect(200);
    expect(res.body).toHaveLength(8);
    expect(res.body.map((k: { id: string }) => k.id)).toContain('coaching');
  });

  it('TEACHER is refused on all three routes (403)', async () => {
    await call('get', '', { role: UserRole.TEACHER }).expect(403);
    await call('post', '/coaching/preview', { role: UserRole.TEACHER }).expect(403);
    await call('post', '/coaching/apply', { role: UserRole.TEACHER }).expect(403);
  });

  it('missing or invalid X-Tenant-ID is refused', async () => {
    // This stack answers a missing or unknown tenant with 401 (see modules-settings.e2e-spec.ts).
    await call('get', '', { tenant: null }).expect(401);
    await call('post', '/coaching/apply', { tenant: 'not-a-uuid' }).expect(401);
    await call('post', '/coaching/apply', {
      tenant: '00000000-0000-4000-8000-0000000c7799',
    }).expect(401);
  });

  it('unknown kind is a 400 with a fixed sentence', async () => {
    const res = await call('post', '/nope-kind/apply').expect(400);
    expect(res.body.message).toBe('Unknown institution kind.');
    expect(JSON.stringify(res.body)).not.toContain('nope-kind');
  });

  it('preview writes nothing and adds no audit row', async () => {
    const before = (await audits('INSTITUTION_KIND_APPLIED')).length;
    const res = await call('post', '/coaching/preview').expect(200);
    expect(res.body.modules.map((m: { key: string }) => m.key)).toContain('fines');
    expect((await stored(TENANT_ID)).modules).toBeUndefined();
    expect((await audits('INSTITUTION_KIND_APPLIED')).length).toBe(before);
  });

  it('apply overwrites switches and words, keeps lock and offForRoles, audits, never touches another school', async () => {
    // A platform lock and a role-off already on `fines`, plus a custom word the kind does not define.
    await dataSource.query(
      `UPDATE schools SET settings = jsonb_set(COALESCE(settings,'{}'), '{modules}',
        '{"fines":{"on":true,"lock":"on","offForRoles":["TEACHER"]}}')
        || jsonb_build_object('labels', '{"teacher":{"bn":"শিক্ষক"}}'::jsonb) WHERE id = $1`,
      [TENANT_ID],
    );
    const key = `kind-${Date.now()}`;
    const run = () => call('post', '/coaching/apply').set('Idempotency-Key', key);
    const first = await run().expect(201);
    const replay = await run().expect(201);
    expect(replay.body).toEqual(first.body);

    const s = await stored(TENANT_ID);
    expect(s.modules.fines).toEqual({ on: false, lock: 'on', offForRoles: ['TEACHER'] });
    expect(s.modules.programs).toEqual({ on: false });
    expect(s.labels.class.bn).toBe('কোর্স');
    expect(s.labels.teacher).toEqual({ bn: 'শিক্ষক' });
    // The replay ran nothing: one audit row per kind.
    expect(await audits('INSTITUTION_KIND_APPLIED')).toHaveLength(1);
    const [row] = await audits('INSTITUTION_KIND_APPLIED');
    expect(row.new_values.kind).toBe('coaching');
    expect((await audits('MODULES_UPDATED')).length).toBeGreaterThan(0);
    expect((await audits('WORDS_UPDATED')).length).toBeGreaterThan(0);

    // Tenant B (also ADMIN here) is untouched until it applies itself.
    expect((await stored(OTHER_TENANT_ID)).modules).toBeUndefined();
  });

  it('a second apply (new key) is a no-op: empty changes, no extra audit row', async () => {
    const before = (await audits('INSTITUTION_KIND_APPLIED')).length;
    const res = await call('post', '/coaching/apply').expect(201);
    expect(res.body).toEqual({ modules: [], labels: [] });
    expect((await audits('INSTITUTION_KIND_APPLIED')).length).toBe(before);
  });
});
