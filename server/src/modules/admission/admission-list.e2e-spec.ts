import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest = require('supertest');
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
  SEED_ACADEMIC_YEAR_ID,
  SEED_CLASS_1_ID,
} from '@test/constants';

const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000000996';
const NO_SUCH = '00000000-0000-4000-8000-0000000000aa';
const BODY = { capacity: 2, act_by_date: '2099-12-31' };

/** [71.2.06] Merit list and waiting lists over HTTP. */
describe('Admission lists (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let token: string;
  let intake: string;
  const people: string[] = [];

  const http = () => supertest(app.getHttpServer());
  const as = (req: supertest.Test, role: UserRole, tenantId: string | null = SEED_TENANT_ID) => {
    req.set('Authorization', `Bearer ${token}`).set('X-Role', role);
    return tenantId === null ? req : req.set('X-Tenant-ID', tenantId);
  };
  const admin = (req: supertest.Test, tenantId: string | null = SEED_TENANT_ID) =>
    as(req, UserRole.ADMIN, tenantId);
  const intakeUrl = (id: string, tail = '') => `/api/v1/admission/intakes/${id}/lists${tail}`;
  const listUrl = (id: string, tail: string) => `/api/v1/admission/lists/${id}/${tail}`;
  const pastDeadline = (id: string) =>
    ds.query(`UPDATE admission_lists SET act_by_date = '2000-01-01' WHERE id = $1`, [id]);
  const auditOps = async (op: string) =>
    Number(
      (
        await ds.query(
          `SELECT count(*) FROM audit_logs WHERE entity_type = 'AdmissionApplicant' AND tenant_id = $1 AND new_values->>'op' = $2`,
          [SEED_TENANT_ID, op],
        )
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
       VALUES ($1, 'Lists Other School', 'lists-other-school', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [OTHER_TENANT_ID],
    );
    for (const [tenant, role] of [
      [SEED_TENANT_ID, UserRole.TEACHER],
      [SEED_TENANT_ID, UserRole.PARENT],
      [SEED_TENANT_ID, UserRole.STUDENT],
      [SEED_TENANT_ID, UserRole.ACCOUNTANT],
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
    await ds.query(`DELETE FROM user_tenants WHERE tenant_id = $1 AND role <> 'ADMIN'`, [
      SEED_TENANT_ID,
    ]);
    await ds.query(`DELETE FROM user_tenants WHERE tenant_id = $1`, [OTHER_TENANT_ID]);
    await app.close();
  });

  beforeEach(async () => {
    for (const t of [
      'admission_list_members',
      'admission_lists',
      'admission_stage_results',
      'admission_applicants',
      'admission_stages',
      'admission_intakes',
    ])
      await ds.query(`DELETE FROM ${t} WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    intake = (
      await ds.query(
        `INSERT INTO admission_intakes
           (id, tenant_id, class_section_id, class_id, academic_year_id, title, seat_count, open_date, close_date,
            required_document_types, roll_prefix, created_at, updated_at)
         VALUES (DEFAULT, $1, $2, $3, $4, 'Lists E2E', 5, '2026-01-01', '2099-12-31', '[]'::jsonb, 'LS-', NOW(), NOW())
         RETURNING id`,
        [SEED_TENANT_ID, SEED_SECTION_1_ID, SEED_CLASS_1_ID, SEED_ACADEMIC_YEAR_ID],
      )
    )[0].id as string;
    people.length = 0;
    for (let i = 0; i < 4; i++) {
      const [{ id }] = await ds.query(
        `INSERT INTO admission_applicants
           (tenant_id, intake_id, reference_number, applicant_name, date_of_birth, gender,
            guardian_name, guardian_phone, status)
         VALUES ($1, $2, $3, $4, '2015-01-01', 'MALE', 'G', '01711000097', 'PENDING') RETURNING id`,
        [SEED_TENANT_ID, intake, `ADM-LS-${i}`, `List Child ${i}`],
      );
      people.push(id as string);
    }
  });

  it('closed by default: only ADMIN (ADMISSION_REVIEW) may use any of the six routes', async () => {
    for (const role of [UserRole.TEACHER, UserRole.PARENT, UserRole.STUDENT, UserRole.ACCOUNTANT]) {
      await as(http().get(intakeUrl(intake)), role).expect(403);
      await as(http().post(intakeUrl(intake, '/merit')).send(BODY), role).expect(403);
      await as(http().post(intakeUrl(intake, '/waiting')).send(BODY), role).expect(403);
      await as(http().post(listUrl(NO_SUCH, 'activate')), role).expect(403);
      await as(http().post(listUrl(NO_SUCH, 'expire-pending')), role).expect(403);
      await as(http().patch(listUrl(NO_SUCH, 'members')).send({}), role).expect(403);
    }
    await http().get(intakeUrl(intake)).expect(401);
    await admin(http().get(intakeUrl(intake))).expect(200);
  });

  it('flow: merit, waiting list, activation after the deadline, expiry, audit rows', async () => {
    const merit = await admin(http().post(intakeUrl(intake, '/merit')).send(BODY)).expect(201);
    expect(merit.body.affected).toBe(2);
    const waiting = await admin(
      http()
        .post(intakeUrl(intake, '/waiting'))
        .send({
          ...BODY,
          act_by_date: '2099-12-31',
          order: 'MANUAL',
          applicant_ids: people.slice(2),
        }),
    ).expect(201);
    expect(waiting.body.affected).toBe(2);

    const view = await admin(http().get(intakeUrl(intake))).expect(200);
    expect(view.body.seat_count).toBe(5);
    expect(view.body.seats_left).toBe(3);
    expect(view.body.lists.map((l: { kind: string }) => l.kind)).toEqual(['MERIT', 'WAITING']);
    expect(view.body.lists[0].counts.OFFERED).toBe(2);
    expect(view.body.lists[1].counts.WAITING).toBe(2);

    const early = await admin(http().post(listUrl(waiting.body.id, 'activate'))).expect(409);
    expect(early.body.details.code).toBe('PREVIOUS_DEADLINE_NOT_PASSED');
    const noDeadline = await admin(http().post(listUrl(waiting.body.id, 'expire-pending')));
    expect(noDeadline.status).toBe(409);
    expect(noDeadline.body.details.code).toBe('LIST_NOT_ACTIVATED');

    await pastDeadline(merit.body.id);
    const done = await admin(http().post(listUrl(waiting.body.id, 'activate'))).expect(200);
    expect(done.body.affected).toBe(2);
    await admin(http().post(listUrl(waiting.body.id, 'activate'))).expect(409);
    expect(await auditOps('ADMISSION_LIST_ACTIVATED')).toBe(1);
    expect(await auditOps('ADMISSION_OFFERS_EXPIRED')).toBe(1);

    const tooSoon = await admin(http().post(listUrl(waiting.body.id, 'expire-pending'))).expect(
      409,
    );
    expect(tooSoon.body.details.code).toBe('DEADLINE_NOT_PASSED');
    await pastDeadline(waiting.body.id);
    const expired = await admin(http().post(listUrl(waiting.body.id, 'expire-pending'))).expect(
      200,
    );
    expect(expired.body.affected).toBe(2);
    const again = await admin(http().post(listUrl(waiting.body.id, 'expire-pending'))).expect(200);
    expect(again.body.affected).toBe(0);
    expect(await auditOps('ADMISSION_OFFERS_EXPIRED')).toBe(3);
  });

  it('members: edit, reorder, then locked once active', async () => {
    const merit = await admin(http().post(intakeUrl(intake, '/merit')).send(BODY)).expect(201);
    const wl = await admin(
      http()
        .post(intakeUrl(intake, '/waiting'))
        .send({ ...BODY, order: 'MERIT' }),
    ).expect(201);
    const view = await admin(http().get(intakeUrl(intake))).expect(200);
    const ids = view.body.lists[1].members.map((m: { applicant_id: string }) => m.applicant_id);
    await admin(
      http()
        .patch(listUrl(wl.body.id, 'members'))
        .send({ order: [ids[1], ids[0]] }),
    ).expect(200);
    await admin(
      http()
        .patch(listUrl(wl.body.id, 'members'))
        .send({ order: [ids[1]] }),
    ).expect(400);
    await pastDeadline(merit.body.id);
    await admin(http().post(listUrl(wl.body.id, 'activate'))).expect(200);
    const locked = await admin(
      http()
        .patch(listUrl(wl.body.id, 'members'))
        .send({ remove: [ids[0]] }),
    ).expect(409);
    expect(locked.body.details.code).toBe('LIST_LOCKED');
  });

  it('bad bodies are 400 (capacity, date, order, unknown field, MANUAL without ids)', async () => {
    for (const bad of [
      { capacity: 0, act_by_date: '2099-12-31' },
      { capacity: 2, act_by_date: 'tomorrow' },
      { capacity: 2, act_by_date: '2099-12-31', extra: 1 },
      { capacity: 100001, act_by_date: '2099-12-31' },
    ])
      await admin(http().post(intakeUrl(intake, '/merit')).send(bad)).expect(400);
    await admin(http().post(intakeUrl(intake, '/merit')).send(BODY)).expect(201);
    for (const bad of [
      { ...BODY, order: 'RANDOM' },
      { ...BODY, order: 'MANUAL' },
      { ...BODY, order: 'FILTER', filter: { group: 'A' } },
    ])
      await admin(http().post(intakeUrl(intake, '/waiting')).send(bad)).expect(400);
  });

  it('a missing or invalid X-Tenant-ID is refused', async () => {
    for (const t of [null, 'not-a-uuid']) {
      for (const req of [
        admin(http().get(intakeUrl(intake)), t),
        admin(http().post(intakeUrl(intake, '/merit')).send(BODY), t),
        admin(http().post(listUrl(NO_SUCH, 'activate')), t),
      ])
        expect([400, 401, 403]).toContain((await req).status);
    }
  });

  it('tenant B cannot see or change tenant A lists', async () => {
    const merit = await admin(http().post(intakeUrl(intake, '/merit')).send(BODY)).expect(201);
    await admin(http().get(intakeUrl(intake)), OTHER_TENANT_ID).expect(404);
    await admin(http().post(intakeUrl(intake, '/merit')).send(BODY), OTHER_TENANT_ID).expect(404);
    await admin(
      http()
        .post(intakeUrl(intake, '/waiting'))
        .send({ ...BODY, order: 'MERIT' }),
      OTHER_TENANT_ID,
    ).expect(404);
    await admin(http().post(listUrl(merit.body.id, 'activate')), OTHER_TENANT_ID).expect(404);
    await admin(http().post(listUrl(merit.body.id, 'expire-pending')), OTHER_TENANT_ID).expect(404);
    await admin(http().patch(listUrl(merit.body.id, 'members')).send({}), OTHER_TENANT_ID).expect(
      404,
    );
  });

  it('a non-UUID id is 400 and an unknown id is 404', async () => {
    await admin(http().get(intakeUrl('nope'))).expect(400);
    await admin(http().post(intakeUrl('nope', '/merit')).send(BODY)).expect(400);
    await admin(http().post(intakeUrl('nope', '/waiting')).send(BODY)).expect(400);
    await admin(http().post(listUrl('nope', 'activate'))).expect(400);
    await admin(http().post(listUrl('nope', 'expire-pending'))).expect(400);
    await admin(http().patch(listUrl('nope', 'members')).send({})).expect(400);
    await admin(http().get(intakeUrl(NO_SUCH))).expect(404);
    await admin(http().post(listUrl(NO_SUCH, 'activate'))).expect(404);
  });

  it('a round in a closed year is 409 ACADEMIC_YEAR_CLOSED on every write', async () => {
    const merit = await admin(http().post(intakeUrl(intake, '/merit')).send(BODY)).expect(201);
    const [year] = await ds.query(`SELECT is_current FROM academic_years WHERE id = $1`, [
      SEED_ACADEMIC_YEAR_ID,
    ]);
    await ds.query(
      `UPDATE academic_years SET closed_at = NOW(), is_current = false WHERE id = $1`,
      [SEED_ACADEMIC_YEAR_ID],
    );
    try {
      const writes = [
        http()
          .post(intakeUrl(intake, '/waiting'))
          .send({ ...BODY, order: 'MERIT' }),
        http().post(listUrl(merit.body.id, 'activate')),
        http().post(listUrl(merit.body.id, 'expire-pending')),
        http().patch(listUrl(merit.body.id, 'members')).send({}),
      ];
      for (const req of writes) {
        const res = await admin(req).expect(409);
        expect(res.body.details.code).toBe('ACADEMIC_YEAR_CLOSED');
      }
      await admin(http().get(intakeUrl(intake))).expect(200);
    } finally {
      await ds.query(`UPDATE academic_years SET closed_at = NULL, is_current = $2 WHERE id = $1`, [
        SEED_ACADEMIC_YEAR_ID,
        year.is_current,
      ]);
    }
  });
});
