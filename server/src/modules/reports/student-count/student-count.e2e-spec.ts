import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import ExcelJS from 'exceljs';
import { UserRole } from '@biddaloy/shared';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import {
  SEED_ACADEMIC_YEAR_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_USER_ID,
  SEED_SECTION_1_ID,
  SEED_TENANT_ID,
} from '@test/constants';
import { AppModule } from '../../../app.module';
import { buildValidationPipeOptions } from '../../../validation-pipe';

/**
 * [8.15.53] `GET /reports/student-count` and its export, over real HTTP with real roles.
 */
describe('Student count E2E', () => {
  let app: INestApplication;
  let ds: DataSource;
  let token: string;

  const http = () => supertest(app.getHttpServer());
  const as = (role: UserRole, req: supertest.Test) =>
    req
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .set('X-Role', role);
  const binary = (res: supertest.Response, cb: (err: Error | null, body: Buffer) => void) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
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

    // The admin also holds the roles under test in the seed school; X-Role picks one per request.
    for (const role of [UserRole.COMMITTEE, UserRole.TEACHER, UserRole.PARENT]) {
      await ds.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [SEED_ADMIN_USER_ID, SEED_TENANT_ID, role],
      );
    }
    const login = await http()
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    token = login.body.access_token;
  }, 90_000);

  // The suite's setup wipes students before every test, so seed per test.
  beforeEach(async () => {
    // A few active students in the seed school, in a year the response can name.
    await ds.query(`UPDATE academic_years SET is_current = TRUE WHERE id = $1`, [
      SEED_ACADEMIC_YEAR_ID,
    ]);
    for (let i = 0; i < 6; i++) {
      await as(UserRole.ADMIN, http().post('/api/v1/students'))
        .send({
          full_name: `বাংলা ছাত্র ${i} ${Date.now()}`,
          class_section_id: SEED_SECTION_1_ID,
          gender: 'MALE',
        })
        .expect(201);
    }
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it('ADMIN gets rows and the true total', async () => {
    const res = await as(UserRole.ADMIN, http().get('/api/v1/reports/student-count')).expect(200);
    expect(res.body.totals.students).toBeGreaterThanOrEqual(6);
    expect(res.body.rows.length).toBeGreaterThan(0);
    expect(res.body.rows[0]).toEqual(
      expect.objectContaining({ class_name: expect.any(String), count: expect.anything() }),
    );
  });

  it('COMMITTEE may open it but sees no count under 5; the total stays true', async () => {
    const admin = await as(UserRole.ADMIN, http().get('/api/v1/reports/student-count')).expect(200);
    const committee = await as(
      UserRole.COMMITTEE,
      http().get('/api/v1/reports/student-count'),
    ).expect(200);
    for (const row of committee.body.rows as Array<{ count: number | null; suppressed: boolean }>) {
      expect(row.count === null || row.count >= 5).toBe(true);
    }
    expect(committee.body.totals.students).toBe(admin.body.totals.students);
  });

  it('a TEACHER and a PARENT (no REPORTS_VIEW) get 403', async () => {
    await as(UserRole.TEACHER, http().get('/api/v1/reports/student-count')).expect(403);
    await as(UserRole.PARENT, http().get('/api/v1/reports/student-count')).expect(403);
  });

  it('a non-UUID academic_year_id is a 400', async () => {
    await as(
      UserRole.ADMIN,
      http().get('/api/v1/reports/student-count?academic_year_id=nope'),
    ).expect(400);
  });

  it('exports an Excel file that opens with Bangla headings intact, in one request', async () => {
    const res = await as(UserRole.ADMIN, http().get('/api/v1/reports/student-count/export'))
      .buffer()
      .parse(binary)
      .expect(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body as ExcelJS.Buffer);
    expect(workbook.worksheets[0].getRow(1).values).toEqual([
      undefined,
      'শ্রেণি',
      'লিঙ্গ',
      'ধর্ম',
      'শিক্ষার্থী',
    ]);
    expect(workbook.worksheets[0].rowCount).toBeGreaterThan(1);
  });

  it('COMMITTEE can open the count but cannot export it (no REPORTS_EXPORT)', async () => {
    await as(UserRole.COMMITTEE, http().get('/api/v1/reports/student-count/export')).expect(403);
  });

  it('exports the staff table as CSV on request', async () => {
    const res = await as(
      UserRole.ADMIN,
      http().get('/api/v1/reports/student-count/export?format=csv&table=staff'),
    ).expect(200);
    expect(res.text.replace(/^﻿/, '').split('\r\n')[0]).toBe('"ধরন","জন"');
  });
});
