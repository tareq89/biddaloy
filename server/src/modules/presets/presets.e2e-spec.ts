import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { PresetRegistryService } from './preset-registry.service';
import { makeTestPack } from './__fixtures__/test-pack';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import {
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
  SEED_ADMIN_USER_ID,
} from '@test/constants';

/**
 * [35.2.6] API-level e2e for curriculum presets: ADMIN status -> apply -> status ->
 * second apply 409 -> SUPER_ADMIN reset -> status -> re-apply, plus the role and
 * validation edges. A role mismatch is a 401 from RolesGuard (see #729); a missing
 * permission is a 403.
 */
const API = '/api/v1';
const TEACHER_ID = '00000000-0000-4000-8000-0000000d3501';
const TEACHER_EMAIL = 'presets-e2e-teacher@testschool.example';
const SUPER_ID = '00000000-0000-4000-8000-0000000d3502';
const SUPER_EMAIL = 'presets-e2e-super@testschool.example';
const LOCAL_SUPER_ID = '00000000-0000-4000-8000-0000000d3503';
const LOCAL_SUPER_EMAIL = 'presets-e2e-local-super@testschool.example';

describe('Curriculum presets E2E (35.2.6)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let registry: PresetRegistryService;
  let originalPacks: PresetRegistryService['packs'];
  const tokens: Record<'admin' | 'teacher' | 'super' | 'localSuper', string> = {
    admin: '',
    teacher: '',
    super: '',
    localSuper: '',
  };
  const schools: string[] = [];

  const login = async (email: string) =>
    (
      await supertest(app.getHttpServer())
        .post(`${API}/auth/login`)
        .send({ email, password: SEED_ADMIN_PASSWORD })
        .expect(200)
    ).body.access_token as string;

  /** A fresh school with all three users as members, so each test gets a clean tenant. */
  const newSchool = async (): Promise<string> => {
    const id = randomUUID();
    await ds.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Presets E2E', $2, NOW(), NOW())`,
      [id, `presets-e2e-${id}`],
    );
    for (const [uid, role] of [
      [SEED_ADMIN_USER_ID, UserRole.ADMIN],
      [TEACHER_ID, UserRole.TEACHER],
      // `super` is a platform SUPER_ADMIN (membership on the platform tenant, see
      // beforeAll) — it deliberately has no row in the school itself.
      [LOCAL_SUPER_ID, UserRole.SUPER_ADMIN],
    ] as const) {
      await ds.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())`,
        [uid, id, role],
      );
    }
    schools.push(id);
    // The JWT embeds memberships, so log in again now that this school exists.
    for (const [k, email] of [
      ['admin', SEED_ADMIN_EMAIL],
      ['teacher', TEACHER_EMAIL],
      ['super', SUPER_EMAIL],
      ['localSuper', LOCAL_SUPER_EMAIL],
    ] as const) {
      tokens[k] = await login(email);
    }
    return id;
  };

  const as = (who: keyof typeof tokens, role: UserRole, tenant: string) => ({
    get: (url: string) =>
      supertest(app.getHttpServer())
        .get(`${API}${url}`)
        .set('Authorization', `Bearer ${tokens[who]}`)
        .set('X-Tenant-ID', tenant)
        .set('X-Role', role),
    post: (url: string) =>
      supertest(app.getHttpServer())
        .post(`${API}${url}`)
        .set('Authorization', `Bearer ${tokens[who]}`)
        .set('X-Tenant-ID', tenant)
        .set('X-Role', role),
  });
  const admin = (t: string) => as('admin', UserRole.ADMIN, t);
  const superAdmin = (t: string) => as('super', UserRole.SUPER_ADMIN, t);

  const body = { preset_id: 'test/pack', start_year: 2026, stages: ['PRIMARY', 'SECONDARY'] };
  const REASON = 'Applied the wrong pack by mistake';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    ds = app.get(DataSource);

    registry = app.get(PresetRegistryService);
    originalPacks = registry.packs;
    const versioned = makeTestPack();
    versioned.id = 'test/versioned';
    versioned.versions = [
      { key: 'BN', name: { en: 'Bangla', bn: 'Bangla' } },
      { key: 'EN', name: { en: 'English', bn: 'English' } },
    ];
    registry.packs = [makeTestPack(), versioned];

    for (const [id, email, role] of [
      [TEACHER_ID, TEACHER_EMAIL, UserRole.TEACHER],
      [SUPER_ID, SUPER_EMAIL, UserRole.SUPER_ADMIN],
      [LOCAL_SUPER_ID, LOCAL_SUPER_EMAIL, UserRole.SUPER_ADMIN],
    ] as const) {
      await ds.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'Presets E2E', 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [id, email, SEED_ADMIN_PASSWORD_HASH],
      );
      void role;
    }
    // Platform authority = SUPER_ADMIN on the platform tenant, which ContextGuard
    // discovers by slug outside production. The test seed has no such school.
    await ds.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       SELECT $1, 'Platform', 'default-school', NOW(), NOW()
       WHERE NOT EXISTS (SELECT 1 FROM schools WHERE slug = 'default-school')`,
      [randomUUID()],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       SELECT $1, id, $2, NOW(), NOW() FROM schools WHERE slug = 'default-school'`,
      [SUPER_ID, UserRole.SUPER_ADMIN],
    );
    await newSchool();
  }, 60000);

  afterAll(async () => {
    registry.packs = originalPacks;
    // Includes the platform-tenant membership added in beforeAll.
    await ds.query(`DELETE FROM user_tenants WHERE user_id = ANY($1)`, [
      [SUPER_ID, LOCAL_SUPER_ID],
    ]);
    if (schools.length) {
      await ds.query(`DELETE FROM user_tenants WHERE tenant_id = ANY($1)`, [schools]);
      // audit_logs is write-only and preset rows are soft-deleted; fresh schools are left behind (unique ids).
    }
    await app.close();
  });

  it('apply -> status -> 409 -> reset -> status -> re-apply', async () => {
    const t = await newSchool();
    const status = async () => (await admin(t).get('/presets/status').expect(200)).body;

    expect((await status()).state).toBe('AVAILABLE');

    const applied = await admin(t).post('/presets/apply').send(body).expect(201);
    expect(applied.body.created).toMatchObject({ classes: 3, subjects: 4, gradingBands: 3 });
    expect((await status()).state).toBe('APPLIED');

    const again = await admin(t).post('/presets/apply').send(body).expect(409);
    expect(again.body.code).toBe('PRESET_NOT_FRESH');

    await superAdmin(t).post(`/platform/schools/${t}/preset/reset`).send({}).expect(400);
    const reset = await superAdmin(t)
      .post(`/platform/schools/${t}/preset/reset`)
      .send({ reason: REASON })
      .expect(200);
    expect(reset.body.deleted.classes).toBe(3);
    expect((await status()).state).toBe('AVAILABLE');

    await admin(t).post('/presets/apply').send(body).expect(201);
  });

  it('read routes: ADMIN lists and previews, TEACHER is refused', async () => {
    const t = await newSchool();
    const list = await admin(t).get('/presets').expect(200);
    expect(list.body.map((p: { id: string }) => p.id)).toContain('test/pack');
    await admin(t)
      .get(`/presets/${encodeURIComponent('test/pack')}`)
      .expect(200);
    await as('teacher', UserRole.TEACHER, t).get('/presets').expect(401);
  });

  it('TEACHER cannot apply, ADMIN cannot reset', async () => {
    const t = await newSchool();
    await as('teacher', UserRole.TEACHER, t).post('/presets/apply').send(body).expect(401);
    await admin(t).post(`/platform/schools/${t}/preset/reset`).send({ reason: REASON }).expect(401);
  });

  it('a tenant-local SUPER_ADMIN cannot reset a school (platform authority required)', async () => {
    const t = await newSchool();
    await as('localSuper', UserRole.SUPER_ADMIN, t)
      .post(`/platform/schools/${t}/preset/reset`)
      .send({ reason: REASON })
      .expect(403);
  });

  it('reset validation: non-uuid id 400, short reason 400, nothing applied 409', async () => {
    const t = await newSchool();
    await superAdmin(t)
      .post('/platform/schools/not-a-uuid/preset/reset')
      .send({ reason: REASON })
      .expect(400);
    await superAdmin(t)
      .post(`/platform/schools/${t}/preset/reset`)
      .send({ reason: 'short' })
      .expect(400);
    const res = await superAdmin(t)
      .post(`/platform/schools/${t}/preset/reset`)
      .send({ reason: REASON })
      .expect(409);
    expect(res.body.code ?? res.body.message).toBeDefined();
  });

  it('apply validation: empty body 400, dup stages 400, unknown stage 400', async () => {
    const t = await newSchool();
    await admin(t).post('/presets/apply').send({}).expect(400);
    await admin(t)
      .post('/presets/apply')
      .send({ ...body, stages: ['PRIMARY', 'PRIMARY'] })
      .expect(400);
    await admin(t)
      .post('/presets/apply')
      .send({ ...body, stages: ['NOPE'] })
      .expect(400);
  });

  it('apply with a versioned pack: versions required, unknown/duplicate rejected, valid applies', async () => {
    const t = await newSchool();
    const v = { ...body, preset_id: 'test/versioned' };
    await admin(t).post('/presets/apply').send(v).expect(400);
    await admin(t)
      .post('/presets/apply')
      .send({ ...v, versions: ['XX'] })
      .expect(400);
    await admin(t)
      .post('/presets/apply')
      .send({ ...v, versions: ['BN', 'BN'] })
      .expect(400);
    await admin(t)
      .post('/presets/apply')
      .send({ ...v, versions: ['BN'] })
      .expect(201);
    expect((await admin(t).get('/presets/status').expect(200)).body.state).toBe('APPLIED');
  });

  it('apply writes its audit row on the transaction', async () => {
    const t = await newSchool();
    await admin(t).post('/presets/apply').send(body).expect(201);
    const rows = await ds.query(
      `SELECT entity_type FROM audit_logs WHERE tenant_id = $1 AND entity_type = 'CurriculumPreset'`,
      [t],
    );
    expect(rows).toHaveLength(1);
  });
});
