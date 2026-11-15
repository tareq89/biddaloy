import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import {
  SEED_TENANT_ID,
  SEED_CLASS_1_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';

/**
 * [71.5.01] Admission admit card over HTTP: who may print it, what it carries (roll, guardian
 * phone, stage date/time/venue), and that another school's stage or applicant never resolves.
 *
 *   ADMIN, OFFICE_STAFF          hold DOCUMENT_PRINT and ADMISSION_REVIEW: allowed
 *   ACCOUNTANT, EXAM_CONTROLLER  hold DOCUMENT_PRINT only: 403 (guardian phone is PII)
 */
const API = '/api/v1';
const PHONE = '01711000555';

describe('Admission admit card print E2E (71.5.01)', () => {
  let app: INestApplication;
  let ds: DataSource;
  const tokens = new Map<string, string>();
  let otherTenantId: string;
  let templateId: string;
  let stageId: string;
  let applicantId: string;
  let noRollId: string;
  let feePendingId: string;
  let otherStageId: string;
  let otherApplicantId: string;

  const http = () => supertest(app.getHttpServer());
  const as = (role: string, tenant = SEED_TENANT_ID) => ({
    Authorization: `Bearer ${tokens.get(role)}`,
    'X-Tenant-ID': tenant,
  });
  const body = (over: Record<string, unknown> = {}) => ({
    template_id: templateId,
    subject_type: 'APPLICANT',
    subject_ids: [applicantId],
    context_type: 'ADMISSION_STAGE',
    context_id: stageId,
    ...over,
  });
  const preview = (role: string, over: Record<string, unknown> = {}, tenant = SEED_TENANT_ID) =>
    http().post(`${API}/print-jobs/preview`).set(as(role, tenant)).send(body(over));

  async function login(email: string): Promise<string> {
    const res = await http()
      .post(`${API}/auth/login`)
      .send({ email, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token;
  }

  async function addUser(tenantId: string, role: UserRole) {
    const id = randomUUID();
    const email = `adm-print-${role.toLowerCase()}-${id}@e2e.example`;
    await ds.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Adm Print E2E', 'ACTIVE', NOW(), NOW())`,
      [id, email, SEED_ADMIN_PASSWORD_HASH],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [id, tenantId, role],
    );
    return email;
  }

  async function seedRound(tenantId: string, classId: string | null) {
    const intake = (
      await ds.query(
        `INSERT INTO admission_intakes
           (tenant_id, class_id, title, seat_count, open_date, close_date,
            required_document_types, roll_prefix, created_at, updated_at)
         VALUES ($1, $2, 'Print Round 2027', 5, '2026-01-01', '2099-12-31', '[]'::jsonb, 'P-', NOW(), NOW())
         RETURNING id`,
        [tenantId, classId],
      )
    )[0].id as string;
    const stage = (
      await ds.query(
        `INSERT INTO admission_stages (tenant_id, intake_id, position, kind, title, config)
         VALUES ($1, $2, 1, 'WRITTEN', 'Written test',
                 '{"date":"2099-01-02","start_time":"10:30","venue":"Main hall"}')
         RETURNING id`,
        [tenantId, intake],
      )
    )[0].id as string;
    return { stage };
  }

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

    tokens.set('ADMIN', await login(SEED_ADMIN_EMAIL));
    for (const role of [UserRole.OFFICE_STAFF, UserRole.ACCOUNTANT, UserRole.EXAM_CONTROLLER]) {
      tokens.set(role, await login(await addUser(SEED_TENANT_ID, role)));
    }
    otherTenantId = (
      await ds.query(
        `INSERT INTO schools (name, name_bn, slug) VALUES ($1, 'বিদ্যালয়', $2) RETURNING id`,
        [`ADM PRINT ${randomUUID()}`, `adm-print-${randomUUID()}`],
      )
    )[0].id;
    tokens.set('OTHER_ADMIN', await login(await addUser(otherTenantId, UserRole.ADMIN)));

    const tpl = await http()
      .post(`${API}/print-templates`)
      .set(as('ADMIN'))
      .send({ name: 'Admission admit card', suggestion_key: 'admission-admit-card-en' })
      .expect(201);
    templateId = tpl.body.id;
    await http()
      .post(`${API}/print-templates/${templateId}/publish`)
      .set(as('ADMIN'))
      .expect((r) => expect(r.status, JSON.stringify(r.body)).toBeLessThan(300));

    const mine = await seedRound(SEED_TENANT_ID, SEED_CLASS_1_ID);
    stageId = mine.stage;
    const insert = async (
      tenantId: string,
      intakeOf: string,
      name: string,
      status: string,
      roll: string | null,
    ) =>
      (
        await ds.query(
          `INSERT INTO admission_applicants
             (tenant_id, intake_id, reference_number, applicant_name, date_of_birth, gender,
              guardian_name, guardian_phone, status, roll_number)
           SELECT $1, s.intake_id, $3, $4, '2015-01-01', 'MALE', 'Guardian', $5, $6, $7
             FROM admission_stages s WHERE s.id = $2 RETURNING id`,
          [tenantId, intakeOf, `ADM-PR-${randomUUID().slice(0, 8)}`, name, PHONE, status, roll],
        )
      )[0].id as string;
    applicantId = await insert(SEED_TENANT_ID, stageId, 'Print Child', 'PENDING', 'P-0001');
    noRollId = await insert(SEED_TENANT_ID, stageId, 'No Roll Child', 'PENDING', null);
    feePendingId = await insert(SEED_TENANT_ID, stageId, 'Unpaid Child', 'FEE_PENDING', 'P-0002');
    const other = await seedRound(otherTenantId, null);
    otherStageId = other.stage;
    otherApplicantId = await insert(
      otherTenantId,
      otherStageId,
      'Other Child',
      'PENDING',
      'P-0001',
    );
  }, 180000);

  afterAll(async () => {
    await app.close();
  });

  it.each([UserRole.ADMIN, UserRole.OFFICE_STAFF])(
    '%s previews the card: roll, guardian phone, stage date, time and venue',
    async (role) => {
      const res = await preview(role).expect(200);
      expect(res.body.items).toHaveLength(1);
      const item = res.body.items[0];
      expect(item.subject_id).toBe(applicantId);
      expect(item.values).toMatchObject({
        'applicant.name': 'Print Child',
        'applicant.roll': 'P-0001',
        'applicant.guardian_phone': PHONE,
        'admission.test_date': '2099-01-02',
        'admission.test_time': '10:30',
        'admission.venue': 'Main hall',
        'admission.round_title': 'Print Round 2027',
        'admission.stage_name': 'Written test',
      });
    },
  );

  it.each([UserRole.ACCOUNTANT, UserRole.EXAM_CONTROLLER])(
    '%s holds DOCUMENT_PRINT but not ADMISSION_REVIEW: 403, nothing about the card leaks',
    async (role) => {
      const res = await preview(role).expect(403);
      expect(JSON.stringify(res.body)).not.toContain(PHONE);
    },
  );

  it("the photo route is closed to a role without ADMISSION_REVIEW, and to a key that is not the applicant's", async () => {
    const q = (key: string) =>
      `${API}/print-jobs/photo?subject_type=APPLICANT&subject_id=${applicantId}&key=${encodeURIComponent(key)}`;
    await http()
      .get(q(`tenants/${SEED_TENANT_ID}/x.jpg`))
      .set(as(UserRole.ACCOUNTANT))
      .expect(403);
    await http()
      .get(q(`tenants/${SEED_TENANT_ID}/x.jpg`))
      .set(as('ADMIN'))
      .expect(404);
    await http()
      .get(q(`tenants/${otherTenantId}/x.jpg`))
      .set(as('ADMIN'))
      .expect(403);
  });

  it('an applicant with no roll, or who has not paid, is not found (404)', async () => {
    await preview('ADMIN', { subject_ids: [noRollId] }).expect(404);
    await preview('ADMIN', { subject_ids: [feePendingId] }).expect(404);
  });

  it("another school's stage is 404, and its applicant on my stage is 404", async () => {
    await preview('ADMIN', { context_id: otherStageId }).expect(404);
    await preview('ADMIN', { subject_ids: [otherApplicantId] }).expect(404);
  });

  it("the other school cannot use this school's template, stage or applicant", async () => {
    await preview('OTHER_ADMIN', {}, otherTenantId).expect(404);
  });

  it('a stage that does not exist is 404; a non-UUID subject or no context is 400', async () => {
    await preview('ADMIN', { context_id: randomUUID() }).expect(404);
    await preview('ADMIN', { subject_ids: ['not-a-uuid'] }).expect(400);
    await preview('ADMIN', { context_type: undefined, context_id: undefined }).expect(400);
  });

  it('a student subject type does not match the admission template (400)', async () => {
    await preview('ADMIN', { subject_type: 'STUDENT' }).expect(400);
  });

  describe('tenant header', () => {
    it('a missing X-Tenant-ID is refused on the preview and photo routes', async () => {
      const auth = { Authorization: `Bearer ${tokens.get('ADMIN')}` };
      await http()
        .post(`${API}/print-jobs/preview`)
        .set(auth)
        .send(body())
        .expect((r) => expect([401, 403]).toContain(r.status));
      await http()
        .get(`${API}/print-jobs/photo?subject_type=APPLICANT&subject_id=${applicantId}&key=x`)
        .set(auth)
        .expect((r) => expect([401, 403]).toContain(r.status));
    });

    it('an invalid X-Tenant-ID is refused', async () => {
      await preview('ADMIN', {}, randomUUID()).expect((r) =>
        expect([401, 403]).toContain(r.status),
      );
    });
  });
});
