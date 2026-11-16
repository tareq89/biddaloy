import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { DataSource } from 'typeorm';
import { PhotoConsent, UserRole } from '@biddaloy/shared';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
  SEED_SECTION_1_ID,
} from '@test/constants';

/** [59.2.01] Photo consent: read, set, filter; REFUSED clears the photo pointer (D26). */
describe('Student photo consent E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;

  const TENANT_ID = SEED_TENANT_ID;
  const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000000097';

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
    dataSource = app.get(DataSource);

    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Consent Other School', 'consent-other-school', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [OTHER_TENANT_ID],
    );
    for (const [tenant, role] of [
      [TENANT_ID, UserRole.TEACHER],
      [OTHER_TENANT_ID, UserRole.ADMIN],
    ]) {
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [SEED_ADMIN_USER_ID, tenant, role],
      );
    }
    const login = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    token = login.body.access_token;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  const http = () => supertest(app.getHttpServer());
  const as = (role: UserRole, req: supertest.Test, tenant = TENANT_ID) =>
    req.set('Authorization', `Bearer ${token}`).set('X-Tenant-ID', tenant).set('X-Role', role);

  async function makeStudent(name: string) {
    const res = await as(UserRole.ADMIN, http().post('/api/v1/students'))
      .send({ full_name: name, class_section_id: SEED_SECTION_1_ID })
      .expect(201);
    return res.body.id as string;
  }

  it('PATCH sets consent as admin, stamps who/when, and the response carries it', async () => {
    const id = await makeStudent('Consent Admin');
    const before = await as(UserRole.ADMIN, http().get(`/api/v1/students/${id}`)).expect(200);
    expect(before.body.photo_consent).toBe(PhotoConsent.UNKNOWN);

    const res = await as(UserRole.ADMIN, http().patch(`/api/v1/students/${id}`))
      .send({ photo_consent: PhotoConsent.GIVEN })
      .expect(200);
    expect(res.body.photo_consent).toBe(PhotoConsent.GIVEN);
    expect(res.body.photo_consent_recorded_by).toBe(SEED_ADMIN_USER_ID);
    expect(res.body.photo_consent_recorded_at).toBeTruthy();
  });

  it('REFUSED clears an existing photo pointer and audits the removal', async () => {
    const id = await makeStudent('Consent Refuse');
    await dataSource.query(`UPDATE students SET photo_key = 'k/old.jpg' WHERE id = $1`, [id]);
    await as(UserRole.ADMIN, http().patch(`/api/v1/students/${id}`))
      .send({ photo_consent: PhotoConsent.REFUSED })
      .expect(200);
    const [row] = await dataSource.query(`SELECT photo_key FROM students WHERE id = $1`, [id]);
    expect(row.photo_key).toBeNull();
    const logs = await dataSource.query(
      `SELECT new_values FROM audit_logs WHERE entity_id = $1 AND action = 'UPDATE'`,
      [id],
    );
    expect(logs[0].new_values.photo_removed).toBe(true);
  });

  it('an unknown consent value is a 400', async () => {
    const id = await makeStudent('Consent Bad');
    await as(UserRole.ADMIN, http().patch(`/api/v1/students/${id}`))
      .send({ photo_consent: 'MAYBE' })
      .expect(400);
  });

  it('list filter ?photo_consent=UNKNOWN returns only those students (list and ids)', async () => {
    const given = await makeStudent('Filter Given');
    const unknown = await makeStudent('Filter Unknown');
    await as(UserRole.ADMIN, http().patch(`/api/v1/students/${given}`))
      .send({ photo_consent: PhotoConsent.GIVEN })
      .expect(200);

    const list = await as(
      UserRole.ADMIN,
      http().get('/api/v1/students?photo_consent=UNKNOWN&limit=100'),
    ).expect(200);
    const listed = list.body.data.map((s: { id: string }) => s.id);
    expect(listed).toContain(unknown);
    expect(listed).not.toContain(given);
    expect(
      list.body.data.every((s: { photo_consent: string }) => s.photo_consent === 'UNKNOWN'),
    ).toBe(true);

    const ids = await as(
      UserRole.ADMIN,
      http().get('/api/v1/students/ids?photo_consent=GIVEN'),
    ).expect(200);
    expect(ids.body.ids).toContain(given);
    expect(ids.body.ids).not.toContain(unknown);

    await as(UserRole.ADMIN, http().get('/api/v1/students?photo_consent=MAYBE')).expect(400);
  });

  it('a TEACHER with no assignment gets 404 on the student (Rule 2) and 403 on PATCH', async () => {
    const id = await makeStudent('Consent Teacher');
    await as(UserRole.TEACHER, http().get(`/api/v1/students/${id}`)).expect(404);
    await as(UserRole.TEACHER, http().patch(`/api/v1/students/${id}`))
      .send({ photo_consent: PhotoConsent.GIVEN })
      .expect(403);
  });

  it('PATCH from another tenant is 404 and changes nothing', async () => {
    const id = await makeStudent('Consent Cross');
    await as(UserRole.ADMIN, http().patch(`/api/v1/students/${id}`), OTHER_TENANT_ID)
      .send({ photo_consent: PhotoConsent.REFUSED })
      .expect(404);
    const [row] = await dataSource.query(`SELECT photo_consent FROM students WHERE id = $1`, [id]);
    expect(row.photo_consent).toBe('UNKNOWN');
  });

  it('requires a valid X-Tenant-ID on PATCH and the list filter', async () => {
    const id = await makeStudent('Consent Header');
    await http()
      .patch(`/api/v1/students/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ photo_consent: PhotoConsent.GIVEN })
      .expect(401);
    await http()
      .get('/api/v1/students?photo_consent=GIVEN')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
    await http()
      .patch(`/api/v1/students/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', 'not-a-uuid')
      .send({ photo_consent: PhotoConsent.GIVEN })
      .expect(401);
  });
});
