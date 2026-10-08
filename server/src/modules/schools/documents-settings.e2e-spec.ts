import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { TENANT_SETTINGS_SCHEMA_VERSION } from './dto/tenant-settings.dto';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
} from '@test/constants';

const API = '/api/v1';
const OTHER_TENANT_ID = '00000000-0000-4000-8000-0000000d4801';
const BODY = {
  version: TENANT_SETTINGS_SCHEMA_VERSION,
  documents: { withholdAdmitCardForDues: true, serialPrefix: 'DAHS' },
};

/**
 * [48.1.03] `settings.documents` through `PATCH/GET /schools/:id/settings`:
 * round trip, validation, the `SETTINGS_MANAGE` role matrix and tenant isolation.
 */
describe('Documents settings (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;

  const patch = (tenant: string, school: string, role: UserRole | null, body: object) => {
    const req = supertest(app.getHttpServer())
      .patch(`${API}/schools/${school}/settings`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', tenant);
    return (role ? req.set('X-Role', role) : req).send(body);
  };
  const get = (tenant: string, school: string) =>
    supertest(app.getHttpServer())
      .get(`${API}/schools/${school}/settings`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', tenant);
  const stored = async (school: string) =>
    (
      await dataSource.query(
        `SELECT settings->'documents' AS documents FROM schools WHERE id = $1`,
        [school],
      )
    )[0].documents;

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
       VALUES ($1, 'Other Documents Settings School', 'other-documents-settings-school', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [OTHER_TENANT_ID],
    );
    // One user holds every role on the seed tenant (switched with X-Role) and
    // ADMIN on a second tenant. Inserted before login: the JWT embeds memberships.
    const memberships: [string, UserRole][] = [
      ...Object.values(UserRole).map((r): [string, UserRole] => [SEED_TENANT_ID, r]),
      [OTHER_TENANT_ID, UserRole.ADMIN],
    ];
    for (const [tenant, role] of memberships) {
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [SEED_ADMIN_USER_ID, tenant, role],
      );
    }

    token = (
      await supertest(app.getHttpServer())
        .post(`${API}/auth/login`)
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200)
    ).body.access_token;
  }, 60000);

  beforeEach(async () => {
    await dataSource.query(`UPDATE schools SET settings = '{}'::jsonb WHERE id = ANY($1)`, [
      [SEED_TENANT_ID, OTHER_TENANT_ID],
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  it('round-trips PATCH -> GET; a school that never saved it gets the default', async () => {
    const res = await patch(SEED_TENANT_ID, SEED_TENANT_ID, null, BODY).expect(200);
    expect(res.body.documents).toEqual(BODY.documents);

    const read = await get(SEED_TENANT_ID, SEED_TENANT_ID).expect(200);
    expect(read.body.documents).toEqual(BODY.documents);

    const other = await get(OTHER_TENANT_ID, OTHER_TENANT_ID).expect(200);
    expect(other.body.documents).toEqual({ withholdAdmitCardForDues: false });
  });

  it('rejects a malformed serialPrefix with 400 and stores nothing', async () => {
    await patch(SEED_TENANT_ID, SEED_TENANT_ID, null, {
      version: TENANT_SETTINGS_SCHEMA_VERSION,
      documents: { serialPrefix: 'da' },
    }).expect(400);
    expect(await stored(SEED_TENANT_ID)).toBeNull();
  });

  it.each([UserRole.ADMIN, UserRole.SUPER_ADMIN])('%s may PATCH documents (200)', async (role) => {
    await patch(SEED_TENANT_ID, SEED_TENANT_ID, role, BODY).expect(200);
    expect(await stored(SEED_TENANT_ID)).toEqual(BODY.documents);
  });

  it.each([
    UserRole.ACCOUNTANT,
    UserRole.EXECUTIVE,
    UserRole.TEACHER,
    UserRole.OFFICE_STAFF,
    UserRole.EXAM_CONTROLLER,
    UserRole.COMMITTEE,
    UserRole.PARENT,
    UserRole.STUDENT,
  ])('%s is denied (403) and the stored block is unchanged', async (role) => {
    await patch(SEED_TENANT_ID, SEED_TENANT_ID, null, BODY).expect(200);
    await patch(SEED_TENANT_ID, SEED_TENANT_ID, role, {
      version: TENANT_SETTINGS_SCHEMA_VERSION,
      documents: { withholdAdmitCardForDues: false },
    }).expect(403);
    expect(await stored(SEED_TENANT_ID)).toEqual(BODY.documents);
  });

  it('is tenant-isolated: another tenant’s ADMIN gets 403 and never sees the prefix', async () => {
    await patch(SEED_TENANT_ID, SEED_TENANT_ID, null, BODY).expect(200);

    await patch(OTHER_TENANT_ID, SEED_TENANT_ID, UserRole.ADMIN, {
      version: TENANT_SETTINGS_SCHEMA_VERSION,
      documents: { serialPrefix: 'EVIL' },
    }).expect(403);
    expect(await stored(SEED_TENANT_ID)).toEqual(BODY.documents);

    const other = await get(OTHER_TENANT_ID, OTHER_TENANT_ID).expect(200);
    expect(JSON.stringify(other.body)).not.toContain('DAHS');
  });

  it('missing X-Tenant-ID is 401', async () => {
    await supertest(app.getHttpServer())
      .patch(`${API}/schools/${SEED_TENANT_ID}/settings`)
      .set('Authorization', `Bearer ${token}`)
      .send(BODY)
      .expect(401);
  });
});
