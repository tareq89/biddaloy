import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { SEED_TENANT_ID, SEED_SECTION_1_ID } from '@test/constants';
import { STRICT_RATE_LIMIT } from '../../rate-limit';

const SEED_SLUG = 'test-school';

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
        SEED_TENANT_ID,
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

  function applicantPayload(intakeId: string, overrides: Record<string, string> = {}) {
    return {
      intake_id: intakeId,
      applicant_name: 'Rahim Uddin',
      date_of_birth: '2018-05-01',
      gender: 'MALE',
      guardian_name: 'Karim Uddin',
      guardian_phone: '01700000001',
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
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await dataSource.query(`DELETE FROM admission_applicants WHERE tenant_id = $1`, [
      SEED_TENANT_ID,
    ]);
    await dataSource.query(`DELETE FROM admission_intakes WHERE tenant_id = $1`, [SEED_TENANT_ID]);
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

  describe('POST /public/admission/:slug/applicants', () => {
    it('accepts a submission and returns a reference number', async () => {
      const intakeId = await createIntake();

      const res = await supertest(app.getHttpServer())
        .post(`/api/v1/public/admission/${SEED_SLUG}/applicants`)
        .field(applicantPayload(intakeId))
        .expect(201);

      expect(res.body.reference_number).toMatch(/^ADM-\d{4}-\d{6}$/);
      expect(res.body.status).toBe('PENDING');

      const rows = await dataSource.query(
        `SELECT * FROM admission_applicants WHERE tenant_id = $1 AND intake_id = $2`,
        [SEED_TENANT_ID, intakeId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].guardian_phone).toBe('01700000001');
    });

    it('resubmitting the same guardian_phone against the same intake updates the PENDING row in place', async () => {
      const intakeId = await createIntake();

      const first = await supertest(app.getHttpServer())
        .post(`/api/v1/public/admission/${SEED_SLUG}/applicants`)
        .field(applicantPayload(intakeId))
        .expect(201);

      const second = await supertest(app.getHttpServer())
        .post(`/api/v1/public/admission/${SEED_SLUG}/applicants`)
        .field(applicantPayload(intakeId, { applicant_name: 'Rahim Uddin (corrected)' }))
        .expect(201);

      expect(second.body.reference_number).toBe(first.body.reference_number);

      const rows = await dataSource.query(
        `SELECT * FROM admission_applicants WHERE tenant_id = $1 AND intake_id = $2`,
        [SEED_TENANT_ID, intakeId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].applicant_name).toBe('Rahim Uddin (corrected)');
    });

    it('rejects a submission once close_date has passed (D14)', async () => {
      const intakeId = await createIntake({ open_date: '2020-01-01', close_date: '2020-01-31' });

      await supertest(app.getHttpServer())
        .post(`/api/v1/public/admission/${SEED_SLUG}/applicants`)
        .field(applicantPayload(intakeId))
        .expect(400);
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
});
