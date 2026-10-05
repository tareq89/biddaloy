import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import cookieParser = require('cookie-parser');
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import ExcelJS from 'exceljs';
import { AppModule } from '../src/app.module';
import { buildValidationPipeOptions } from '../src/validation-pipe';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';

/**
 * [13.3.5] One school's first day, end to end, on a tenant created by self-registration only:
 * register -> checklist -> apply a preset -> import staff -> fill the trial's seats ->
 * next student refused -> finish onboarding.
 */
describe('Onboarding journey (server)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let token: string;
  let tenantId: string;

  const http = () => supertest(app.getHttpServer());
  const as = (req: supertest.Test) =>
    req.set('Authorization', `Bearer ${token}`).set('X-Tenant-ID', tenantId).set('X-Role', 'ADMIN');
  const status = async () => (await as(http().get('/api/v1/onboarding/status')).expect(200)).body;
  const done = (s: { items: { id: string; done: boolean }[] }) =>
    Object.fromEntries(s.items.map((i) => [i.id, i.done]));

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    process.env.ACCOUNT_ACCESS_ECHO_SECRETS = 'true';
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    app.use(cookieParser());
    await app.init();
    ds = app.get(DataSource);
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  it('registers a school and signs the admin in', async () => {
    const suffix = `${Date.now()}`.slice(-7);
    const school_name = `Journey School ${suffix}`;
    // Turnstile has no secret outside production, so any captcha_token passes.
    const s = await http()
      .post('/api/v1/auth/register/start')
      .send({
        admin_name: 'Journey Admin',
        school_name,
        country_code: 'BD',
        address: '1 Test Road, Dhaka',
        phone: `0171${suffix}`,
        email: `journey-${suffix}@example.com`,
        terms_accepted: true,
        captcha_token: 'ok',
      })
      .expect(202);
    const v = await http()
      .post('/api/v1/auth/register/verify')
      .send({ registration_id: s.body.registration_id, otp: s.body.debug.otp })
      .expect(200);
    token = v.body.access_token;
    [{ id: tenantId }] = await ds.query(`SELECT id FROM schools WHERE name = $1`, [school_name]);
  });

  it('starts with an almost empty checklist and a 30 day, 10 seat trial', async () => {
    const s = await status();
    expect(s.finished_at).toBeNull();
    // Only the admin exists: staff needs 2; nothing else has been created.
    expect(Object.values(done(s)).filter(Boolean)).toEqual([]);
    expect(s.counts).toMatchObject({ classes: 0, sections: 0, students: 0, staff: 1 });
    expect(s.trial.days_left).toBe(30);
    expect(s.trial.seats).toEqual({ used: 0, limit: 10 });
  });

  it('applying a curriculum preset flips structure', async () => {
    await as(http().post('/api/v1/presets/apply'))
      .send({ preset_id: 'bd/nctb', start_year: 2026, stages: ['PRIMARY'], versions: ['bangla'] })
      .expect(201);
    const s = await status();
    expect(done(s).structure).toBe(true);
    expect(s.counts.classes).toBeGreaterThan(0);
  });

  it('imports two staff from a workbook and the staff item flips', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Staff');
    ws.addRow(['Name', 'Mobile', 'Email', 'Role', 'Designation']);
    ws.addRow(['Teacher One', '01711000201', '', 'Teacher', '']);
    ws.addRow(['Accountant One', '01711000202', '', 'Accountant', '']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());

    const v = await as(http().post('/api/v1/users/bulk-upload/validate'))
      .attach('file', buf, 'staff.xlsx')
      .expect(201);
    expect(v.body.hard_error_count).toBe(0);
    await as(http().post('/api/v1/users/bulk-upload/commit'))
      .send({ staging_id: v.body.staging_id, send_invitations: false })
      .expect(201);

    const s = await status();
    expect(done(s).staff).toBe(true);
    expect(s.counts.staff).toBe(3);
  });

  it('fills the trial seats, then refuses the next student with SEAT_LIMIT_REACHED', async () => {
    const [cls] = await ds.query(`SELECT id FROM classes WHERE tenant_id = $1 LIMIT 1`, [tenantId]);
    const sec = await as(http().post(`/api/v1/classes/${cls.id}/sections`))
      .send({ section_name: 'A' })
      .expect(201);
    expect(done(await status()).sections).toBe(true);

    const add = (n: number) =>
      as(http().post('/api/v1/students')).send({
        full_name: `Journey Student ${n}`,
        class_section_id: sec.body.id,
      });
    for (let n = 1; n <= 10; n++) await add(n).expect(201);

    const s = await status();
    expect(done(s).students).toBe(true);
    expect(s.trial.seats).toEqual({ used: 10, limit: 10 });

    const refused = await add(11).expect(409);
    expect(refused.body.details ?? refused.body.message?.details).toMatchObject({
      code: 'SEAT_LIMIT_REACHED',
      used: 10,
      limit: 10,
    });
    expect((await status()).trial.seats.used).toBe(10);
  });

  it('marks onboarding finished', async () => {
    const res = await as(http().patch('/api/v1/onboarding')).send({ finished: true }).expect(200);
    expect(res.body.finished_at).not.toBeNull();
    expect((await status()).finished_at).not.toBeNull();
  });
});
