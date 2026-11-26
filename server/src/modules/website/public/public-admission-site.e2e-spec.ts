import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import supertest = require('supertest');
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import type Redis from 'ioredis';
import { AppModule } from '../../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import { EICAR, startFakeClamd } from '@test/helpers/fake-clamd';
import { StorageService } from '../../storage/storage.service';
import {
  SEED_TENANT_ID,
  SEED_SECTION_1_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
} from '@test/constants';
import { UserRole } from '@biddaloy/shared';
import { AppThrottlerGuard } from '../../../common/rate-limit/app-throttler.guard';
import { FailOpenThrottlerStorage } from '../../../common/rate-limit/fail-open-throttler-storage';
import { BULK_IMPORT_REDIS } from '../../bulk-import/import-staging.service';
import { acquire, release } from '../../workbook/restore/restore-lock';
import { TurnstileService } from '../../registration/turnstile.service';
import { TenantStatusService } from '../../schools/tenant-status.service';
import {
  ADMISSION_WRITE_UNAVAILABLE,
  PublicAdmissionSiteController,
} from './public-admission-site.controller';
import { PublicAdmissionSiteService } from './public-admission-site.service';

const ROOT = 'admission.e2e.test';
const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000000998';
const PHONE = '01700000001';
const BASE = (host: string) => `/api/v1/public/site/by-host/${host}/admission`;

/** [#4187] The school site's admission API: host in, no tenant header anywhere. */
describe('Public site admission API (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let hostA: string;
  const hostB = `other.${ROOT}`;
  const api = () => supertest(app.getHttpServer());

  const intake = async (tenant: string, showNames = false, title = 'Class 1 Admission') =>
    (
      await ds.query(
        `INSERT INTO admission_intakes (tenant_id, class_section_id, title, seat_count, open_date,
           close_date, required_document_types, show_names_publicly, created_at, updated_at)
         VALUES ($1, $2, $3, 5, '2026-01-01', '2099-12-31', '[]'::jsonb, $4, NOW(), NOW()) RETURNING id`,
        [tenant, tenant === SEED_TENANT_ID ? SEED_SECTION_1_ID : null, title, showNames],
      )
    )[0].id as string;

  const applicant = async (tenant: string, intakeId: string, roll: string | null, name = 'Rahim') =>
    (
      await ds.query(
        `INSERT INTO admission_applicants (tenant_id, intake_id, reference_number, applicant_name,
           date_of_birth, gender, guardian_name, guardian_phone, documents, status, roll_number,
           created_at, updated_at)
         VALUES ($1,$2,$3,$4,'2018-01-01','MALE','Karim',$5,'[]'::jsonb,'PENDING',$6,NOW(),NOW())
         RETURNING id`,
        [
          tenant,
          intakeId,
          `ADM-2026-${Math.floor(Math.random() * 900000 + 100000)}`,
          name,
          PHONE,
          roll,
        ],
      )
    )[0].id as string;

  const payload = (intakeId: string) => ({
    intake_id: intakeId,
    applicant_name: 'Rahim Uddin',
    date_of_birth: '2018-05-01',
    gender: 'MALE',
    guardian_name: 'Karim Uddin',
    guardian_phone: PHONE,
    // The public form must choose (D27): the DTO rejects UNKNOWN/no choice.
    photo_consent: 'GIVEN',
    captcha_token: 'no-captcha',
  });

  const countApplicants = async (intakeId: string) =>
    (await ds.query(`SELECT 1 FROM admission_applicants WHERE intake_id = $1`, [intakeId])).length;

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    process.env.SITE_ROOT_DOMAIN = ROOT;
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    ds = app.get(DataSource);
    const token = (
      await api()
        .post('/api/v1/auth/login')
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200)
    ).body.access_token;
    // An admin read opens the school's site row; the test setup empties it before every `it`.
    (globalThis as { __adminToken?: string }).__adminToken = token;
  }, 60_000);

  afterAll(async () => {
    await ds.query(`DELETE FROM school_sites WHERE tenant_id IN ($1, $2)`, [
      SEED_TENANT_ID,
      OTHER_TENANT_ID,
    ]);
    await ds.query(`DELETE FROM schools WHERE id = $1`, [OTHER_TENANT_ID]);
    await app.close();
  });

  beforeEach(async () => {
    const token = (globalThis as { __adminToken?: string }).__adminToken;
    const site = (
      await api()
        .get('/api/v1/website')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Role', UserRole.ADMIN)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200)
    ).body;
    await ds.query(
      `UPDATE school_sites SET published = draft, enabled = true WHERE tenant_id = $1`,
      [SEED_TENANT_ID],
    );
    hostA = `${site.subdomain}.${ROOT}`;
    await ds.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Other Admission School', 'other-adm-site', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [OTHER_TENANT_ID],
    );
    // Tenant B's site: a copy of A's row under its own tenant and subdomain.
    const cols = (
      await ds.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'school_sites' AND column_name NOT IN ('id', 'tenant_id', 'subdomain')`,
      )
    ).map((c: { column_name: string }) => `"${c.column_name}"`);
    await ds.query(
      `INSERT INTO school_sites (tenant_id, subdomain, ${cols.join(', ')})
       SELECT $1, 'other', ${cols.join(', ')} FROM school_sites WHERE tenant_id = $2`,
      [OTHER_TENANT_ID, SEED_TENANT_ID],
    );
  });

  it('unknown host answers the one identical 404 on every route', async () => {
    const bodies = [
      (
        await api()
          .get(`${BASE('nope.' + ROOT)}/rounds`)
          .expect(404)
      ).body.message,
      (
        await api()
          .get(`${BASE('nope.' + ROOT)}/lists`)
          .expect(404)
      ).body.message,
      (
        await api()
          .post(`${BASE('nope.' + ROOT)}/status`)
          .send({ reference_number: 'X', guardian_phone: PHONE })
          .expect(404)
      ).body.message,
      (
        await api()
          .post(`${BASE('nope.' + ROOT)}/result`)
          .send({ roll_number: '1', guardian_phone: PHONE })
          .expect(404)
      ).body.message,
    ];
    expect(new Set(bodies)).toEqual(new Set(['site.not_found']));
  });

  it('lists open rounds with their form and fee settings, no-store, no tenant header', async () => {
    const id = await intake(SEED_TENANT_ID);
    const res = await api()
      .get(`${BASE(hostA)}/rounds`)
      .expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual([
      expect.objectContaining({
        id,
        form: expect.objectContaining({ fields: expect.any(Array) }),
        fee_pay_methods: expect.any(Array),
      }),
    ]);
  });

  it("tenant A's host cannot read tenant B's round or list", async () => {
    const b = await intake(OTHER_TENANT_ID, true, 'B round');
    const res = await api()
      .get(`${BASE(hostA)}/rounds`)
      .expect(200);
    expect(res.body).toEqual([]);
    expect(
      JSON.stringify(
        (
          await api()
            .get(`${BASE(hostA)}/lists`)
            .expect(200)
        ).body,
      ),
    ).not.toContain(b);
    const submit = await api()
      .post(`${BASE(hostA)}/applicants`)
      .field(payload(b))
      .expect((r) => expect([404, 400, 409]).toContain(r.status));
    expect(submit.status).not.toBe(201);
    expect(await countApplicants(b)).toBe(0);
  });

  describe('POST applicants', () => {
    it('submits with no tenant header', async () => {
      const id = await intake(SEED_TENANT_ID);
      const res = await api()
        .post(`${BASE(hostA)}/applicants`)
        .set('Idempotency-Key', 'k-1')
        .field(payload(id))
        .expect(201);
      expect(res.body.reference_number).toMatch(/^ADM-/);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(await countApplicants(id)).toBe(1);
    });

    describe('fee proof', () => {
      const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
      const feeIntake = async (fee: number | null) => {
        const id = await intake(SEED_TENANT_ID);
        await ds.query(`UPDATE admission_intakes SET fee_amount_paisa = $2 WHERE id = $1`, [
          id,
          fee,
        ]);
        return id;
      };
      const proofs = async (intakeId: string) =>
        ds.query(
          `SELECT p.method, p.reference FROM admission_fee_proofs p
             JOIN admission_applicants a ON a.id = p.applicant_id WHERE a.intake_id = $1`,
          [intakeId],
        );

      it('a fee round takes method + reference + proof and answers FEE_PENDING', async () => {
        const id = await feeIntake(50000);
        const res = await api()
          .post(`${BASE(hostA)}/applicants`)
          .field({ ...payload(id), fee_method: 'BKASH', fee_reference: 'TX123' })
          .attach('fee_proof', JPEG, { filename: 'p.jpg', contentType: 'image/jpeg' })
          .expect(201);
        expect(res.body).toEqual({
          reference_number: expect.stringMatching(/^ADM-/),
          status: 'FEE_PENDING',
          fee_status: 'AWAITING',
        });
        expect(await proofs(id)).toEqual([{ method: 'BKASH', reference: 'TX123' }]);
      });

      it('a fee round without proof or method is a plain 400 and writes nothing', async () => {
        const id = await feeIntake(50000);
        const noProof = await api()
          .post(`${BASE(hostA)}/applicants`)
          .field({ ...payload(id), fee_method: 'BKASH' })
          .expect(400);
        expect(noProof.body.message).toBe('A fee payment method and proof file are required');
        await api()
          .post(`${BASE(hostA)}/applicants`)
          .field(payload(id))
          .attach('fee_proof', JPEG, { filename: 'p.jpg', contentType: 'image/jpeg' })
          .expect(400);
        expect(await countApplicants(id)).toBe(0);
      });

      it('a proof whose bytes are not an image is refused', async () => {
        const id = await feeIntake(50000);
        await api()
          .post(`${BASE(hostA)}/applicants`)
          .field({ ...payload(id), fee_method: 'BKASH' })
          .attach('fee_proof', Buffer.from('<html>x</html>'), {
            filename: 'p.jpg',
            contentType: 'image/jpeg',
          })
          .expect(400);
        expect(await countApplicants(id)).toBe(0);
      });

      it('a free round ignores fee fields and stores no proof', async () => {
        const id = await feeIntake(null);
        const res = await api()
          .post(`${BASE(hostA)}/applicants`)
          .field({ ...payload(id), fee_method: 'BKASH' })
          .attach('fee_proof', JPEG, { filename: 'p.jpg', contentType: 'image/jpeg' })
          .expect(201);
        expect(res.body.status).toBe('PENDING');
        expect(res.body.fee_status).toBe('NONE');
        expect(await proofs(id)).toEqual([]);
      });
    });

    // [#4000, D19] Public route, no login: a harmful file or a dead scanner refuses the upload.
    describe('virus scan (fail closed)', () => {
      let fake: Awaited<ReturnType<typeof startFakeClamd>>;
      let put: ReturnType<typeof vi.spyOn>;
      const pdf = (body: string) => Buffer.from(`%PDF-1.4 ${body}`, 'latin1');
      const submitPdf = (id: string, body: string) =>
        api()
          .post(`${BASE(hostA)}/applicants`)
          .field(payload(id))
          .attach('birth_certificate', pdf(body), {
            filename: 'b.pdf',
            contentType: 'application/pdf',
          });

      beforeEach(async () => {
        fake = await startFakeClamd();
        process.env.CLAMAV_HOST = '127.0.0.1';
        process.env.CLAMAV_PORT = String(fake.port);
        put = vi.spyOn(app.get(StorageService), 'put');
      });
      afterEach(async () => {
        put.mockRestore();
        await fake.close();
        delete process.env.CLAMAV_HOST;
        delete process.env.CLAMAV_PORT;
      });

      it('a normal PDF is accepted', async () => {
        const id = await intake(SEED_TENANT_ID);
        await submitPdf(id, 'hello').expect(201);
        expect(put).toHaveBeenCalledTimes(1);
      });

      it('an EICAR PDF is 422 FILE_HARMFUL with no object stored and no applicant row', async () => {
        const id = await intake(SEED_TENANT_ID);
        const res = await submitPdf(id, EICAR).expect(422);
        expect(res.body.details.code).toBe('FILE_HARMFUL');
        expect(put).not.toHaveBeenCalled();
        expect(await countApplicants(id)).toBe(0);
      });

      it('with the scanner down it is 503 FILE_CHECK_UNAVAILABLE and nothing is stored', async () => {
        await fake.close();
        const id = await intake(SEED_TENANT_ID);
        const res = await submitPdf(id, 'hello').expect(503);
        expect(res.body.details.code).toBe('FILE_CHECK_UNAVAILABLE');
        expect(put).not.toHaveBeenCalled();
        expect(await countApplicants(id)).toBe(0);
      });
    });

    it('a Turnstile failure writes nothing', async () => {
      const id = await intake(SEED_TENANT_ID);
      const config = app.get(ConfigService);
      const realGet = config.get.bind(config);
      const spy = vi
        .spyOn(config, 'get')
        .mockImplementation(((k: string) =>
          k === 'TURNSTILE_SECRET_KEY' ? 'test-secret' : realGet(k)) as typeof config.get);
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: false }) }),
      );
      try {
        const res = await api()
          .post(`${BASE(hostA)}/applicants`)
          .field(payload(id))
          .expect(400);
        expect(res.body.details.code).toBe('CAPTCHA_FAILED');
      } finally {
        spy.mockRestore();
        vi.unstubAllGlobals();
      }
      expect(await countApplicants(id)).toBe(0);
    });

    it('the restore freeze refuses a submit and writes nothing', async () => {
      const id = await intake(SEED_TENANT_ID);
      const redis = app.get<Redis>(BULK_IMPORT_REDIS);
      await acquire(redis, SEED_TENANT_ID, 'job-site-admission-freeze');
      try {
        const res = await api()
          .post(`${BASE(hostA)}/applicants`)
          .field(payload(id))
          .expect(423);
        expect(res.body.details.code).toBe('TENANT_RESTORING');
      } finally {
        await release(redis, SEED_TENANT_ID, 'job-site-admission-freeze');
      }
      expect(await countApplicants(id)).toBe(0);
    });
  });

  describe('roll + phone lookups', () => {
    it('a wrong roll answers exactly what a wrong phone does, for result and admit card', async () => {
      const id = await intake(SEED_TENANT_ID);
      await applicant(SEED_TENANT_ID, id, 'R-0001');
      for (const route of ['result', 'admit-card']) {
        const wrongRoll = await api()
          .post(`${BASE(hostA)}/${route}`)
          .send({ roll_number: 'R-9999', guardian_phone: PHONE })
          .expect(404);
        const wrongPhone = await api()
          .post(`${BASE(hostA)}/${route}`)
          .send({ roll_number: 'R-0001', guardian_phone: '01899999999' })
          .expect(404);
        const strip = ({ requestId: _r, timestamp: _t, ...rest }: Record<string, unknown>) => rest;
        expect(strip(wrongRoll.body)).toEqual(strip(wrongPhone.body));
        expect(JSON.stringify(wrongRoll.body)).not.toContain('Rahim');
      }
    });

    it("another school's roll is not found on this host", async () => {
      const b = await intake(OTHER_TENANT_ID);
      await applicant(OTHER_TENANT_ID, b, 'B-0001');
      await api()
        .post(`${BASE(hostA)}/result`)
        .send({ roll_number: 'B-0001', guardian_phone: PHONE })
        .expect(404);
    });

    it('result shows only published stages and lists; admit card shows the schedule', async () => {
      const id = await intake(SEED_TENANT_ID);
      const a = await applicant(SEED_TENANT_ID, id, 'R-0002');
      const [pub] = await ds.query(
        `INSERT INTO admission_stages (tenant_id, intake_id, position, kind, title, config, created_at, updated_at)
         VALUES ($1,$2,1,'WRITTEN','Written','{"published_at":"2026-01-01","date":"2099-01-01","start_time":"10:00","venue":"Hall"}'::jsonb,NOW(),NOW()) RETURNING id`,
        [SEED_TENANT_ID, id],
      );
      const [hid] = await ds.query(
        `INSERT INTO admission_stages (tenant_id, intake_id, position, kind, title, config, created_at, updated_at)
         VALUES ($1,$2,2,'VIVA','Viva','{}'::jsonb,NOW(),NOW()) RETURNING id`,
        [SEED_TENANT_ID, id],
      );
      for (const s of [pub.id, hid.id]) {
        await ds.query(
          `INSERT INTO admission_stage_results (tenant_id, stage_id, applicant_id, passed, created_at, updated_at)
           VALUES ($1,$2,$3,true,NOW(),NOW())`,
          [SEED_TENANT_ID, s, a],
        );
      }
      const res = await api()
        .post(`${BASE(hostA)}/result`)
        .send({ roll_number: 'r-0002', guardian_phone: PHONE })
        .expect(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body.stages).toEqual([{ title: 'Written', outcome: 'PASSED' }]);
      const card = await api()
        .post(`${BASE(hostA)}/admit-card`)
        .send({ roll_number: 'R-0002', guardian_phone: PHONE })
        .expect(200);
      expect(card.body.schedule).toEqual([
        expect.objectContaining({ title: 'Written', date: '2099-01-01', venue: 'Hall' }),
      ]);
    });
  });

  describe('GET lists', () => {
    const publishList = async (intakeId: string, applicantId: string) => {
      const [l] = await ds.query(
        `INSERT INTO admission_lists (tenant_id, intake_id, kind, sequence, order_by, capacity, published_at, created_at, updated_at)
         VALUES ($1,$2,'MERIT',1,'MERIT',5,NOW(),NOW(),NOW()) RETURNING id`,
        [SEED_TENANT_ID, intakeId],
      );
      await ds.query(
        `INSERT INTO admission_list_members (tenant_id, list_id, applicant_id, position, created_at, updated_at)
         VALUES ($1,$2,$3,1,NOW(),NOW())`,
        [SEED_TENANT_ID, l.id, applicantId],
      );
    };

    it('shows roll numbers only unless show_names_publicly is on', async () => {
      const id = await intake(SEED_TENANT_ID, false);
      await publishList(id, await applicant(SEED_TENANT_ID, id, 'R-0003', 'Secret Name'));
      const off = await api()
        .get(`${BASE(hostA)}/lists`)
        .expect(200);
      expect(off.body[0].members).toEqual([{ position: 1, roll_number: 'R-0003' }]);
      expect(JSON.stringify(off.body)).not.toContain('Secret Name');

      await ds.query(`UPDATE admission_intakes SET show_names_publicly = true WHERE id = $1`, [id]);
      const on = await api()
        .get(`${BASE(hostA)}/lists`)
        .expect(200);
      expect(on.body[0].members[0].applicant_name).toBe('Secret Name');
    });
  });
});

// Throttling is skipped in the e2e app (NODE_ENV=test), so the outage is staged on a probe app:
// the real controller and guard, a rate-limit store that is down.
describe('Public site admission, Redis down (e2e)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const ref = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot({
          throttlers: [{ name: 'default', limit: 100, ttl: 60_000 }],
          storage: new FailOpenThrottlerStorage({
            increment: () => Promise.reject(new Error('ECONNREFUSED')),
          }),
        }),
      ],
      controllers: [PublicAdmissionSiteController],
      providers: [
        { provide: APP_GUARD, useClass: AppThrottlerGuard },
        { provide: PublicAdmissionSiteService, useValue: {} },
        { provide: TurnstileService, useValue: { verify: vi.fn() } },
        { provide: TenantStatusService, useValue: { isRestoring: vi.fn() } },
      ],
    }).compile();
    app = ref.createNestApplication();
    configureApiVersioning(app);
    await app.init();
  });
  afterAll(async () => app.close());

  it('answers 503 with the site text on submit and result', async () => {
    for (const path of ['applicants', 'result']) {
      const res = await supertest(app.getHttpServer())
        .post(`/api/v1/public/site/by-host/h.test/admission/${path}`)
        .send({})
        .expect(503);
      expect(res.body.message).toBe(ADMISSION_WRITE_UNAVAILABLE);
    }
  });
});
