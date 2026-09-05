import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import { UserRole, AttendanceDeviceKind } from '@biddaloy/shared';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
  SEED_SECTION_1_ID,
} from '@test/constants';

const API = '/api/v1';

/**
 * E2E tests for [9.5]'s device-authenticated surface: admin device
 * management (JWT-guarded) and the credential-authenticated ingest/roster
 * routes (`DeviceAuthGuard`-guarded).
 */
describe('Attendance Devices E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;
  let teacherToken: string;

  const TENANT_ID = SEED_TENANT_ID;

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/biddaloy';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    await app.listen(0);

    dataSource = app.get(DataSource);

    const adminLoginRes = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    adminToken = adminLoginRes.body.access_token;

    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [SEED_ADMIN_USER_ID, TENANT_ID, UserRole.TEACHER],
    );
    const teacherLoginRes = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    teacherToken = teacherLoginRes.body.access_token;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  function adminHeaders() {
    return {
      Authorization: `Bearer ${adminToken}`,
      'X-Tenant-ID': TENANT_ID,
      'X-Role': UserRole.ADMIN,
    };
  }
  function teacherHeaders() {
    return {
      Authorization: `Bearer ${teacherToken}`,
      'X-Tenant-ID': TENANT_ID,
      'X-Role': UserRole.TEACHER,
    };
  }

  it('creates a device and returns the raw key exactly once', async () => {
    const res = await supertest(app.getHttpServer())
      .post(`${API}/attendance/devices`)
      .set(adminHeaders())
      .send({ name: 'Front Gate', kind: AttendanceDeviceKind.RFID })
      .expect(201);

    expect(res.body.key).toMatch(/^bd_dev_/);
    expect(res.body.device).not.toHaveProperty('token_hash');
  });

  it('never includes token_hash or the raw key in the list response', async () => {
    const createRes = await supertest(app.getHttpServer())
      .post(`${API}/attendance/devices`)
      .set(adminHeaders())
      .send({ name: 'List Test Device', kind: AttendanceDeviceKind.BIOMETRIC })
      .expect(201);

    const listRes = await supertest(app.getHttpServer())
      .get(`${API}/attendance/devices`)
      .set(adminHeaders())
      .expect(200);

    const body = JSON.stringify(listRes.body);
    expect(body).not.toContain('token_hash');
    expect(body).not.toContain(createRes.body.key);
  });

  it('invalidates the old key immediately on rotate', async () => {
    const createRes = await supertest(app.getHttpServer())
      .post(`${API}/attendance/devices`)
      .set(adminHeaders())
      .send({ name: 'Rotate Test Device', kind: AttendanceDeviceKind.FACE })
      .expect(201);
    const deviceId = createRes.body.device.id;
    const oldKey = createRes.body.key;

    const rotateRes = await supertest(app.getHttpServer())
      .post(`${API}/attendance/devices/${deviceId}/rotate`)
      .set(adminHeaders())
      .expect(201);
    const newKey = rotateRes.body.key;

    const batch = {
      events: [
        { device_event_id: 'rotate-check', occurred_at: new Date().toISOString(), direction: 'IN' },
      ],
    };

    await supertest(app.getHttpServer())
      .post(`${API}/attendance/device-events`)
      .set('X-Device-Key', oldKey)
      .send(batch)
      .expect(401);

    await supertest(app.getHttpServer())
      .post(`${API}/attendance/device-events`)
      .set('X-Device-Key', newKey)
      .send(batch)
      .expect(200);
  });

  it('401s a revoked device key', async () => {
    const createRes = await supertest(app.getHttpServer())
      .post(`${API}/attendance/devices`)
      .set(adminHeaders())
      .send({ name: 'Revoke Test Device', kind: AttendanceDeviceKind.OTHER })
      .expect(201);
    const deviceId = createRes.body.device.id;
    const key = createRes.body.key;

    await supertest(app.getHttpServer())
      .delete(`${API}/attendance/devices/${deviceId}`)
      .set(adminHeaders())
      .expect(204);

    await supertest(app.getHttpServer())
      .post(`${API}/attendance/device-events`)
      .set('X-Device-Key', key)
      .send({ events: [] })
      .expect(401);
  });

  it('403s a TEACHER calling the management routes', async () => {
    await supertest(app.getHttpServer())
      .post(`${API}/attendance/devices`)
      .set(teacherHeaders())
      .send({ name: 'Teacher Attempt', kind: AttendanceDeviceKind.RFID })
      .expect(401);
  });

  it('returns exactly the five allowed roster fields', async () => {
    const createRes = await supertest(app.getHttpServer())
      .post(`${API}/attendance/devices`)
      .set(adminHeaders())
      .send({
        name: 'Roster Test Device',
        kind: AttendanceDeviceKind.FACE,
        section_id: SEED_SECTION_1_ID,
        roster_access: true,
      })
      .expect(201);
    const key = createRes.body.key;

    const rosterRes = await supertest(app.getHttpServer())
      .get(`${API}/attendance/devices/me/roster`)
      .set('X-Device-Key', key)
      .expect(200);

    expect(Array.isArray(rosterRes.body)).toBe(true);
    if (rosterRes.body.length > 0) {
      expect(Object.keys(rosterRes.body[0]).sort()).toEqual(
        ['full_name', 'registration_number', 'roll_number', 'section_id', 'student_id'].sort(),
      );
    }
  });

  it('403s the roster route for a device without roster_access', async () => {
    const createRes = await supertest(app.getHttpServer())
      .post(`${API}/attendance/devices`)
      .set(adminHeaders())
      .send({
        name: 'No Roster Device',
        kind: AttendanceDeviceKind.RFID,
        section_id: SEED_SECTION_1_ID,
      })
      .expect(201);

    await supertest(app.getHttpServer())
      .get(`${API}/attendance/devices/me/roster`)
      .set('X-Device-Key', createRes.body.key)
      .expect(403);
  });
});
