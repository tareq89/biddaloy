import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest = require('supertest');
import ExcelJS from 'exceljs';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { AllExceptionsFilter } from '../../common/filters/http-exception.filter';
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

/** [71.G2.06] Lottery draw and list import. */
describe('Admission lottery (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let token: string;
  let intake: string;
  let stage: string;
  const refs: string[] = [];

  const http = () => supertest(app.getHttpServer());
  const as = (req: supertest.Test, role: UserRole, tenantId: string | null = SEED_TENANT_ID) => {
    req.set('Authorization', `Bearer ${token}`).set('X-Role', role);
    return tenantId === null ? req : req.set('X-Tenant-ID', tenantId);
  };
  const admin = (req: supertest.Test, tenantId: string | null = SEED_TENANT_ID) =>
    as(req, UserRole.ADMIN, tenantId);
  const url = (id: string, tail: string) => `/api/v1/admission/stages/${id}/lottery/${tail}`;

  const sheet = async (rows: (string | number)[][]) => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('s');
    ws.addRow(['reference_number', 'rank']);
    rows.forEach((r) => ws.addRow(r));
    return Buffer.from(await wb.xlsx.writeBuffer());
  };
  const upload = (id: string, buf: Buffer, name = 'list.xlsx') =>
    admin(http().post(url(id, 'import/validate')).attach('file', buf, name));
  const resultCount = async () =>
    Number(
      (
        await ds.query(`SELECT count(*) FROM admission_stage_results WHERE stage_id = $1`, [stage])
      )[0].count,
    );

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    ds = app.get(DataSource);
    await ds.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Lottery Other School', 'lottery-other-school', NOW(), NOW()) ON CONFLICT DO NOTHING`,
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
         VALUES (DEFAULT, $1, $2, 'Lottery E2E', 5, '2026-01-01', '2099-12-31', '[]'::jsonb, 'L-', NOW(), NOW())
         RETURNING id`,
        [SEED_TENANT_ID, SEED_SECTION_1_ID],
      )
    )[0].id as string;
    stage = (
      await ds.query(
        `INSERT INTO admission_stages (tenant_id, intake_id, position, kind, config)
         VALUES ($1, $2, 1, 'LOTTERY', '{}') RETURNING id`,
        [SEED_TENANT_ID, intake],
      )
    )[0].id as string;
    refs.length = 0;
    for (let i = 0; i < 3; i++) {
      const ref = `ADM-LT-${i}`;
      refs.push(ref);
      await ds.query(
        `INSERT INTO admission_applicants
           (tenant_id, intake_id, reference_number, applicant_name, date_of_birth, gender,
            guardian_name, guardian_phone, status)
         VALUES ($1, $2, $3, $4, '2015-01-01', 'MALE', 'G', '01711000097', 'PENDING')`,
        [SEED_TENANT_ID, intake, ref, `Lottery Child ${i}`],
      );
    }
  });

  it('draw: ADMIN ok, TEACHER 403, second draw 409, no tenant header 4xx, other tenant 404', async () => {
    await as(http().post(url(stage, 'draw')), UserRole.TEACHER).expect(403);
    await admin(http().post(url(stage, 'draw')), null).expect(401);
    await admin(http().post(url(stage, 'draw')), OTHER_TENANT_ID).expect(404);
    await admin(http().post(url('not-a-uuid', 'draw'))).expect(400);
    await admin(http().post(url(NO_SUCH, 'draw'))).expect(404);
    const res = await admin(http().post(url(stage, 'draw'))).expect(200);
    expect(res.body).toEqual({ drawn: 3 });
    const again = await admin(http().post(url(stage, 'draw'))).expect(409);
    expect(again.body.details.code).toBe('LOTTERY_ALREADY_DRAWN');
    expect(await resultCount()).toBe(3);
  });

  it('import: validate then commit once, then the stage is full', async () => {
    const ok = await upload(
      stage,
      await sheet([
        [refs[0], 3],
        [refs[1], 1],
        [refs[2], 2],
      ]),
    ).expect(200);
    expect(ok.body.errors).toEqual([]);
    expect(await resultCount()).toBe(0);
    await as(http().post(url(stage, 'import/commit')), UserRole.TEACHER)
      .send({ staging_id: ok.body.staging_id })
      .expect(403);
    await admin(http().post(url(stage, 'import/commit')))
      .send({ staging_id: ok.body.staging_id })
      .expect(200, { imported: 3 });
    await admin(http().post(url(stage, 'import/commit')))
      .send({ staging_id: ok.body.staging_id })
      .expect(404);
    const [best] = await ds.query(
      `SELECT a.reference_number AS ref FROM admission_stage_results r
         JOIN admission_applicants a ON a.id = r.applicant_id
        WHERE r.stage_id = $1 ORDER BY r.score DESC LIMIT 1`,
      [stage],
    );
    expect(best.ref).toBe(refs[1]); // rank 1 holds the top points
    const late = await upload(stage, await sheet([[refs[0], 1]])).expect(409);
    expect(late.body.details.code).toBe('LOTTERY_ALREADY_DRAWN');
    await admin(http().post(url(stage, 'draw'))).expect(409);
  });

  it('import: row errors never echo cells and nothing is staged', async () => {
    const secret = 'SECRET-CELL-VALUE';
    const res = await upload(
      stage,
      await sheet([
        [secret, 1],
        [refs[0], 2],
        [refs[1], 2],
        [refs[1], 'zz-bad'],
      ]),
    ).expect(200);
    expect(res.body.staging_id).toBeNull();
    const codes = res.body.errors.map((e: { code: string }) => e.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        'UNKNOWN_APPLICANT',
        'DUPLICATE_RANK',
        'DUPLICATE_APPLICANT',
        'INVALID_RANK',
        'MISSING_APPLICANTS',
      ]),
    );
    const text = JSON.stringify(res.body);
    for (const cellValue of [secret, 'zz-bad', refs[0], refs[1]])
      expect(text).not.toContain(cellValue);
    expect(await resultCount()).toBe(0);
  });

  it('import: bytes that are not xlsx are 400 and store nothing; tenant is isolated', async () => {
    await upload(stage, Buffer.from('not,a,zip\n1,2,3'), 'list.xlsx').expect(400);
    await upload(stage, Buffer.from('rank\n1'), 'list.csv').expect(400);
    await admin(http().post(url(stage, 'import/validate'))).expect(400);
    await as(
      http()
        .post(url(stage, 'import/validate'))
        .attach('file', await sheet([[refs[0], 1]]), 'l.xlsx'),
      UserRole.ADMIN,
      OTHER_TENANT_ID,
    ).expect(404);
    expect(await resultCount()).toBe(0);
  });
});
