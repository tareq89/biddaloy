import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TurnstileService } from '../registration/turnstile.service';
import { DataSource } from 'typeorm';
import type Redis from 'ioredis';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { SEED_TENANT_ID, SEED_SECTION_1_ID } from '@test/constants';
import { ADMISSION_STATUS_RATE_LIMIT, STRICT_RATE_LIMIT } from '../../rate-limit';
import { StorageService } from '../storage/storage.service';
import { BULK_IMPORT_REDIS } from '../bulk-import/import-staging.service';
import { acquire, release } from '../workbook/restore/restore-lock';

// A real JPEG signature — matchesDeclaredType only inspects the header, so
// this passes without needing an actual decodable image.
const VALID_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

const SEED_SLUG = 'test-school';
const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000000999';
const OTHER_TENANT_SLUG = 'other-admission-school';

/**
 * E2E coverage for [27.2]'s public admission surface — `GET
 * /public/admission/:slug` and `POST /public/admission/:slug/applicants`.
 * No auth header, no `X-Tenant-ID`, anywhere in this file: the whole point
 * of the route is that a caller has neither.
 */
describe('Public Admission Submission E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  async function createIntake(overrides: Partial<Record<string, unknown>> = {}): Promise<string> {
    const res = await dataSource.query(
      `INSERT INTO admission_intakes
         (id, tenant_id, class_section_id, title, seat_count, open_date, close_date, required_document_types, created_at, updated_at)
       VALUES (DEFAULT, $1, $2, $3, $4, $5::date, $6::date, $7::jsonb, NOW(), NOW())
       RETURNING id`,
      [
        (overrides.tenant_id as string) ?? SEED_TENANT_ID,
        SEED_SECTION_1_ID,
        (overrides.title as string) ?? 'Class 1 Admission 2026',
        (overrides.seat_count as number) ?? 2,
        (overrides.open_date as string) ?? '2026-01-01',
        (overrides.close_date as string) ?? '2099-12-31',
        JSON.stringify((overrides.required_document_types as string[]) ?? []),
      ],
    );
    return res[0].id;
  }

  async function createApplicant(
    tenantId: string,
    intakeId: string,
    overrides: Partial<Record<string, unknown>> = {},
  ): Promise<string> {
    const referenceNumber =
      (overrides.reference_number as string) ??
      `ADM-2026-${Math.floor(Math.random() * 900000 + 100000)}`;
    await dataSource.query(
      `INSERT INTO admission_applicants
         (id, tenant_id, intake_id, reference_number, applicant_name, date_of_birth, gender, guardian_name, guardian_phone, documents, status, created_at, updated_at)
       VALUES (DEFAULT, $1, $2, $3, $4, '2018-01-01', 'MALE', 'Karim Uddin', '01700000001', '[]'::jsonb, $5, NOW(), NOW())`,
      [
        tenantId,
        intakeId,
        referenceNumber,
        (overrides.applicant_name as string) ?? 'Rahim Uddin',
        (overrides.status as string) ?? 'PENDING',
      ],
    );
    return referenceNumber;
  }

  function applicantPayload(intakeId: string, overrides: Record<string, string> = {}) {
    return {
      intake_id: intakeId,
      applicant_name: 'Rahim Uddin',
      date_of_birth: '2018-05-01',
      gender: 'MALE',
      guardian_name: 'Karim Uddin',
      guardian_phone: '01700000001',
      // No TURNSTILE_SECRET_KEY in tests: any non-empty token passes unchecked.
      captcha_token: 'no-captcha',
      ...overrides,
    };
  }

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL must be set to run e2e tests');
    }
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
       VALUES ($1, 'Other Admission School', $2, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [OTHER_TENANT_ID, OTHER_TENANT_SLUG],
    );
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await dataSource.query(`DELETE FROM admission_applicants WHERE tenant_id IN ($1, $2)`, [
      SEED_TENANT_ID,
      OTHER_TENANT_ID,
    ]);
    await dataSource.query(`DELETE FROM admission_intakes WHERE tenant_id IN ($1, $2)`, [
      SEED_TENANT_ID,
      OTHER_TENANT_ID,
    ]);
  });

  describe('GET /public/admission/:slug', () => {
    it('lists open intakes with no auth and no tenant header', async () => {
      const intakeId = await createIntake();

      const res = await supertest(app.getHttpServer())
        .get(`/api/v1/public/admission/${SEED_SLUG}`)
        .expect(200);

      expect(res.body).toEqual([
        expect.objectContaining({ id: intakeId, title: 'Class 1 Admission 2026' }),
      ]);
    });

    it('404s for an unknown slug rather than leaking any tenant data', async () => {
      await createIntake();

      await supertest(app.getHttpServer())
        .get('/api/v1/public/admission/no-such-school')
        .expect(404);
    });

    it('excludes an intake whose close_date has passed', async () => {
      await createIntake({ open_date: '2020-01-01', close_date: '2020-01-31' });

      const res = await supertest(app.getHttpServer())
        .get(`/api/v1/public/admission/${SEED_SLUG}`)
        .expect(200);

      expect(res.body).toEqual([]);
    });
  });

  describe('POST /public/admission/:slug/status', () => {
    it('returns status/applicant name/intake title for a valid reference number + guardian phone, no auth needed', async () => {
      const intakeId = await createIntake({ title: 'Class 1 Admission 2026' });
      const referenceNumber = await createApplicant(SEED_TENANT_ID, intakeId, {
        applicant_name: 'Rahim Uddin',
        status: 'SHORTLISTED',
      });

      const res = await supertest(app.getHttpServer())
        .post(`/api/v1/public/admission/${SEED_SLUG}/status`)
        .send({ reference_number: referenceNumber, guardian_phone: '01700000001' })
        .expect(200);

      expect(res.body).toEqual({
        status: 'SHORTLISTED',
        applicant_name: 'Rahim Uddin',
        intake_title: 'Class 1 Admission 2026',
      });
    });

    it('accepts the same phone in +880 international format', async () => {
      const intakeId = await createIntake({ title: 'Class 1 Admission 2026' });
      const referenceNumber = await createApplicant(SEED_TENANT_ID, intakeId);

      await supertest(app.getHttpServer())
        .post(`/api/v1/public/admission/${SEED_SLUG}/status`)
        .send({ reference_number: referenceNumber, guardian_phone: '+8801700000001' })
        .expect(200);
    });

    it('404s for a wrong guardian phone, same as an unknown reference number', async () => {
      const intakeId = await createIntake();
      const referenceNumber = await createApplicant(SEED_TENANT_ID, intakeId);

      await supertest(app.getHttpServer())
        .post(`/api/v1/public/admission/${SEED_SLUG}/status`)
        .send({ reference_number: referenceNumber, guardian_phone: '01799999999' })
        .expect(404);
    });

    it('404s for an unknown reference number without leaking existence of other applicants', async () => {
      const intakeId = await createIntake();
      await createApplicant(SEED_TENANT_ID, intakeId);

      await supertest(app.getHttpServer())
        .post(`/api/v1/public/admission/${SEED_SLUG}/status`)
        .send({ reference_number: 'ADM-2026-ZZZZZZ', guardian_phone: '01700000001' })
        .expect(404);
    });

    it('404s for a reference number that belongs to a different tenant', async () => {
      const otherIntakeId = await createIntake({ tenant_id: OTHER_TENANT_ID });
      const referenceNumber = await createApplicant(OTHER_TENANT_ID, otherIntakeId);

      await supertest(app.getHttpServer())
        .post(`/api/v1/public/admission/${SEED_SLUG}/status`)
        .send({ reference_number: referenceNumber, guardian_phone: '01700000001' })
        .expect(404);
    });

    it('404s for an unknown slug', async () => {
      const intakeId = await createIntake();
      const referenceNumber = await createApplicant(SEED_TENANT_ID, intakeId);

      await supertest(app.getHttpServer())
        .post(`/api/v1/public/admission/no-such-school/status`)
        .send({ reference_number: referenceNumber, guardian_phone: '01700000001' })
        .expect(404);
    });

    it('is wired to the ADMISSION_STATUS_RATE_LIMIT tier (30/min)', () => {
      expect(ADMISSION_STATUS_RATE_LIMIT).toEqual({ limit: 30, ttl: 60_000 });
    });
  });

  describe('POST /public/admission/:slug/applicants', () => {
    const submitUrl = `/api/v1/public/admission/${SEED_SLUG}/applicants`;
    const countRows = async (intakeId: string) =>
      (
        await dataSource.query(`SELECT 1 FROM admission_applicants WHERE intake_id = $1`, [
          intakeId,
        ])
      ).length;

    it('rejects a submission whose captcha token Cloudflare rejects', async () => {
      const intakeId = await createIntake();
      const spy = vi
        .spyOn(TurnstileService.prototype, 'verify')
        .mockRejectedValue(new BadRequestException('Captcha verification failed'));
      try {
        await supertest(app.getHttpServer())
          .post(submitUrl)
          .field(applicantPayload(intakeId))
          .attach('photo', VALID_JPEG, { filename: 'p.jpg', contentType: 'image/jpeg' })
          .expect(400);
      } finally {
        spy.mockRestore();
      }
      expect(await countRows(intakeId)).toBe(0);
    });

    it('400s when captcha_token is missing', async () => {
      const intakeId = await createIntake();
      const { captcha_token: _omit, ...noToken } = applicantPayload(intakeId);
      await supertest(app.getHttpServer()).post(submitUrl).field(noToken).expect(400);
      expect(await countRows(intakeId)).toBe(0);
    });

    it('answers 503 in production with no secret and stores nothing', async () => {
      const intakeId = await createIntake();
      // ConfigService caches its values at boot, so flip NODE_ENV on the service itself.
      const config = app.get(ConfigService);
      const realGet = config.get.bind(config);
      const spy = vi
        .spyOn(config, 'get')
        .mockImplementation(((key: string) =>
          key === 'NODE_ENV' ? 'production' : realGet(key)) as typeof config.get);
      try {
        await supertest(app.getHttpServer())
          .post(submitUrl)
          .field(applicantPayload(intakeId))
          .expect(503);
      } finally {
        spy.mockRestore();
      }
      expect(await countRows(intakeId)).toBe(0);
    });

    it('accepts a submission and returns a reference number', async () => {
      const intakeId = await createIntake();

      const res = await supertest(app.getHttpServer())
        .post(`/api/v1/public/admission/${SEED_SLUG}/applicants`)
        .field(applicantPayload(intakeId))
        .expect(201);

      expect(res.body.reference_number).toMatch(/^ADM-\d{4}-[0-9A-HJKMNP-TV-Z]{6}$/);
      expect(res.body.status).toBe('PENDING');

      const rows = await dataSource.query(
        `SELECT * FROM admission_applicants WHERE tenant_id = $1 AND intake_id = $2`,
        [SEED_TENANT_ID, intakeId],
      );
      expect(rows).toHaveLength(1);
      // Stored canonical (880...), not the raw '01700000001' the request
      // sent — see the storage-side note in admission-applicant.service.ts.
      expect(rows[0].guardian_phone).toBe('8801700000001');
    });

    it('two children, same guardian phone, different name/DOB -> two reference numbers', async () => {
      const intakeId = await createIntake();
      const post = (o: Record<string, string>) =>
        supertest(app.getHttpServer())
          .post(`/api/v1/public/admission/${SEED_SLUG}/applicants`)
          .field(applicantPayload(intakeId, o));

      const a = await post({}).expect(201);
      const b = await post({ applicant_name: 'Karima Uddin', date_of_birth: '2018-05-02' }).expect(
        201,
      );

      expect(b.body.reference_number).not.toBe(a.body.reference_number);
      const rows = await dataSource.query(
        `SELECT applicant_name FROM admission_applicants WHERE tenant_id = $1 AND intake_id = $2 ORDER BY applicant_name`,
        [SEED_TENANT_ID, intakeId],
      );
      expect(rows.map((r: { applicant_name: string }) => r.applicant_name)).toEqual([
        'Karima Uddin',
        'Rahim Uddin',
      ]);
    });

    it('409s the same child (name differs only in case/spaces) without a reference number', async () => {
      const intakeId = await createIntake();
      await supertest(app.getHttpServer())
        .post(`/api/v1/public/admission/${SEED_SLUG}/applicants`)
        .field(applicantPayload(intakeId))
        .expect(201);

      await supertest(app.getHttpServer())
        .post(`/api/v1/public/admission/${SEED_SLUG}/applicants`)
        .field(applicantPayload(intakeId, { applicant_name: '  rahim   UDDIN ' }))
        .expect(409);
    });

    it('PENDING duplicate and REVIEWED duplicate return byte-identical 409 bodies (PUB-09)', async () => {
      const intakeId = await createIntake();
      const post = () =>
        supertest(app.getHttpServer())
          .post(`/api/v1/public/admission/${SEED_SLUG}/applicants`)
          .field(applicantPayload(intakeId));
      await post().expect(201);

      const pending = await post().expect(409);
      await dataSource.query(
        `UPDATE admission_applicants SET status = 'REJECTED' WHERE tenant_id = $1 AND intake_id = $2`,
        [SEED_TENANT_ID, intakeId],
      );
      const reviewed = await post().expect(409);

      expect(reviewed.text).toBe(pending.text);
      // The public form has no reference-number field: point the guardian to the school instead.
      expect(pending.body.message).toContain('contact the school with your reference number');
    });

    it('409s a duplicate whose date_of_birth is an ISO timestamp, with the same text', async () => {
      const intakeId = await createIntake();
      const post = (o: Record<string, string>) =>
        supertest(app.getHttpServer())
          .post(`/api/v1/public/admission/${SEED_SLUG}/applicants`)
          .field(applicantPayload(intakeId, o));
      await post({}).expect(201);

      const plain = await post({}).expect(409);
      const iso = await post({ date_of_birth: '2018-05-01T00:00:00.000Z' }).expect(409);
      expect(iso.text).toBe(plain.text);
    });

    it('409s renaming a PENDING row (by reference) into a sibling with the exact same name', async () => {
      const intakeId = await createIntake();
      const post = (o: Record<string, string>) =>
        supertest(app.getHttpServer())
          .post(`/api/v1/public/admission/${SEED_SLUG}/applicants`)
          .field(applicantPayload(intakeId, o));
      await post({}).expect(201);
      const b = await post({ applicant_name: 'Karima Uddin' }).expect(201);

      await post({
        applicant_name: 'Rahim Uddin',
        reference_number: b.body.reference_number,
      }).expect(409);
    });

    it('409s renaming a PENDING row into a REVIEWED sibling (case/space-variant name)', async () => {
      const intakeId = await createIntake();
      const post = (o: Record<string, string>) =>
        supertest(app.getHttpServer())
          .post(`/api/v1/public/admission/${SEED_SLUG}/applicants`)
          .field(applicantPayload(intakeId, o));
      const a = await post({}).expect(201);
      const b = await post({ applicant_name: 'Karima Uddin' }).expect(201);
      await dataSource.query(
        `UPDATE admission_applicants SET status = 'REJECTED' WHERE reference_number = $1`,
        [a.body.reference_number],
      );

      await post({
        applicant_name: ' rahim  UDDIN',
        reference_number: b.body.reference_number,
      }).expect(409);
    });

    it('resubmitting with the reference_number updates the PENDING row in place', async () => {
      const intakeId = await createIntake();

      const first = await supertest(app.getHttpServer())
        .post(`/api/v1/public/admission/${SEED_SLUG}/applicants`)
        .field(applicantPayload(intakeId))
        .expect(201);

      const second = await supertest(app.getHttpServer())
        .post(`/api/v1/public/admission/${SEED_SLUG}/applicants`)
        .field(
          applicantPayload(intakeId, {
            applicant_name: 'Rahim Uddin (corrected)',
            reference_number: first.body.reference_number,
          }),
        )
        .expect(201);

      expect(second.body.reference_number).toBe(first.body.reference_number);

      const rows = await dataSource.query(
        `SELECT * FROM admission_applicants WHERE tenant_id = $1 AND intake_id = $2`,
        [SEED_TENANT_ID, intakeId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].applicant_name).toBe('Rahim Uddin (corrected)');
    });

    it('409s a resubmission for the same phone that omits the reference_number (ownership not proven)', async () => {
      const intakeId = await createIntake();

      await supertest(app.getHttpServer())
        .post(`/api/v1/public/admission/${SEED_SLUG}/applicants`)
        .field(applicantPayload(intakeId))
        .expect(201);

      await supertest(app.getHttpServer())
        .post(`/api/v1/public/admission/${SEED_SLUG}/applicants`)
        .field(applicantPayload(intakeId, { applicant_name: 'RAHIM  uddin' }))
        .expect(409);
    });

    it('rejects a submission once close_date has passed (D14)', async () => {
      const intakeId = await createIntake({ open_date: '2020-01-01', close_date: '2020-01-31' });

      await supertest(app.getHttpServer())
        .post(`/api/v1/public/admission/${SEED_SLUG}/applicants`)
        .field(applicantPayload(intakeId))
        .expect(400);
    });

    it('rejects a submission before open_date', async () => {
      const intakeId = await createIntake({ open_date: '2099-01-01', close_date: '2099-12-31' });

      await supertest(app.getHttpServer())
        .post(`/api/v1/public/admission/${SEED_SLUG}/applicants`)
        .field(applicantPayload(intakeId))
        .expect(400);
    });

    it('409s a resubmission from a guardian phone already SHORTLISTED for this intake', async () => {
      const intakeId = await createIntake();
      await createApplicant(SEED_TENANT_ID, intakeId, { status: 'SHORTLISTED' });

      await supertest(app.getHttpServer())
        .post(`/api/v1/public/admission/${SEED_SLUG}/applicants`)
        .field(applicantPayload(intakeId, { date_of_birth: '2018-01-01' }))
        .expect(409);
    });

    it('rejects a submission once every seat is ADMITTED (D14)', async () => {
      const intakeId = await createIntake({ seat_count: 1 });
      await dataSource.query(
        `INSERT INTO admission_applicants
           (id, tenant_id, intake_id, reference_number, applicant_name, date_of_birth, gender, guardian_name, guardian_phone, documents, status, created_at, updated_at)
         VALUES (DEFAULT, $1, $2, 'ADM-2026-000001', 'Existing Applicant', '2018-01-01', 'MALE', 'G', '01700000099', '[]'::jsonb, 'ADMITTED', NOW(), NOW())`,
        [SEED_TENANT_ID, intakeId],
      );

      await supertest(app.getHttpServer())
        .post(`/api/v1/public/admission/${SEED_SLUG}/applicants`)
        .field(applicantPayload(intakeId))
        .expect(400);
    });

    it('silently no-ops when the honeypot field is filled, returning 200-shaped success', async () => {
      const intakeId = await createIntake();

      const res = await supertest(app.getHttpServer())
        .post(`/api/v1/public/admission/${SEED_SLUG}/applicants`)
        .field(applicantPayload(intakeId, { middle_name_confirm: 'a bot filled this' }))
        .expect(201);

      expect(res.body.reference_number).toBeDefined();

      const rows = await dataSource.query(
        `SELECT * FROM admission_applicants WHERE tenant_id = $1 AND intake_id = $2`,
        [SEED_TENANT_ID, intakeId],
      );
      expect(rows).toHaveLength(0);
    });

    // [68.1.2210] This route has no ContextGuard, so it checks the restore freeze itself: an
    // applicant saved mid-restore would be deleted by the restore and be missing from its snapshot.
    it('423s with TENANT_RESTORING and saves nothing while the school is being restored', async () => {
      const intakeId = await createIntake();
      const redis = app.get<Redis>(BULK_IMPORT_REDIS);

      await acquire(redis, SEED_TENANT_ID, 'job-admission-freeze');
      try {
        const res = await supertest(app.getHttpServer())
          .post(`/api/v1/public/admission/${SEED_SLUG}/applicants`)
          .field(applicantPayload(intakeId))
          .expect(423);
        expect(res.body.details.code).toBe('TENANT_RESTORING');
        const rows = await dataSource.query(
          `SELECT 1 FROM admission_applicants WHERE tenant_id = $1 AND intake_id = $2`,
          [SEED_TENANT_ID, intakeId],
        );
        expect(rows).toHaveLength(0);
      } finally {
        await release(redis, SEED_TENANT_ID, 'job-admission-freeze');
      }
    });

    it("404s for a slug from a different tenant, never leaking another tenant's intake", async () => {
      const intakeId = await createIntake();

      await supertest(app.getHttpServer())
        .post(`/api/v1/public/admission/no-such-school/applicants`)
        .field(applicantPayload(intakeId))
        .expect(404);
    });

    // The full e2e stack globally disables throttling when NODE_ENV=test
    // (see app.module.ts's ThrottlerModule.forRootAsync `skipIf`) — same
    // convention public-invoice.e2e-spec.ts uses for its rate-limit tier:
    // assert the constant directly rather than a flaky real 429.
    it('is wired to the tightened STRICT_RATE_LIMIT tier (5/min)', () => {
      expect(STRICT_RATE_LIMIT).toEqual({ limit: 5, ttl: 60_000 });
    });
  });

  describe('POST /public/admission/:slug/applicants — document uploads', () => {
    it('stores a valid document with its type and a storage key', async () => {
      const intakeId = await createIntake({ required_document_types: ['PHOTO'] });

      const res = await supertest(app.getHttpServer())
        .post(`/api/v1/public/admission/${SEED_SLUG}/applicants`)
        .field(applicantPayload(intakeId))
        .attach('photo', VALID_JPEG, { filename: 'p.jpg', contentType: 'image/jpeg' })
        .expect(201);

      const rows = await dataSource.query(
        `SELECT documents FROM admission_applicants WHERE tenant_id = $1 AND intake_id = $2`,
        [SEED_TENANT_ID, intakeId],
      );
      expect(rows[0].documents).toEqual([
        { type: 'PHOTO', storage_key: expect.stringContaining('tenants/') },
      ]);
      expect(res.body.reference_number).toBeDefined();
    });

    it('400s naming the field when a file does not match its declared type', async () => {
      const intakeId = await createIntake({ required_document_types: ['PHOTO'] });

      const res = await supertest(app.getHttpServer())
        .post(`/api/v1/public/admission/${SEED_SLUG}/applicants`)
        .field(applicantPayload(intakeId))
        .attach('photo', Buffer.from('x'), { filename: 'p.jpg', contentType: 'image/jpeg' })
        .expect(400);

      expect(res.body.message).toContain('photo');

      const rows = await dataSource.query(
        `SELECT * FROM admission_applicants WHERE tenant_id = $1 AND intake_id = $2`,
        [SEED_TENANT_ID, intakeId],
      );
      expect(rows).toHaveLength(0);
    });

    it('400s naming the missing type when a required document is absent', async () => {
      const intakeId = await createIntake({
        required_document_types: ['PHOTO', 'BIRTH_CERTIFICATE'],
      });

      const res = await supertest(app.getHttpServer())
        .post(`/api/v1/public/admission/${SEED_SLUG}/applicants`)
        .field(applicantPayload(intakeId))
        .attach('photo', VALID_JPEG, { filename: 'p.jpg', contentType: 'image/jpeg' })
        .expect(400);

      expect(res.body.message).toContain('BIRTH_CERTIFICATE');
    });

    it('deletes the uploaded object when the submission fails after the upload', async () => {
      const intakeId = await createIntake({ required_document_types: ['PHOTO'] });
      const storage = app.get(StorageService);
      const deleteSpy = vi.spyOn(storage, 'delete');

      await createApplicant(SEED_TENANT_ID, intakeId, { status: 'SHORTLISTED' });

      await supertest(app.getHttpServer())
        .post(`/api/v1/public/admission/${SEED_SLUG}/applicants`)
        .field(applicantPayload(intakeId, { date_of_birth: '2018-01-01' }))
        .attach('photo', VALID_JPEG, { filename: 'p.jpg', contentType: 'image/jpeg' })
        .expect(409); // duplicate SHORTLISTED phone — the transaction throws after the upload

      expect(deleteSpy).toHaveBeenCalledWith(expect.stringContaining('tenants/'));
      deleteSpy.mockRestore();
    });
  });
});
