import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { UserRole } from '@biddaloy/shared';
import {
  SEED_TENANT_ID,
  SEED_ACADEMIC_YEAR_ID,
  SEED_SECTION_1_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';

/**
 * [66.2.03/#2008] E2E for `/lesson-deliveries`. The routine has one weekly
 * Monday slot, so every write targets the most recent Monday (always 0-6 days
 * ago, inside the 7-day window); the closed-window case uses that Monday - 14.
 */
const API = '/api/v1';
const TENANT_2 = '00000000-0000-4000-8000-0000007d0002';

const USERS = {
  T: { id: '00000000-0000-4000-8000-0000007d0001', role: UserRole.TEACHER },
  S: { id: '00000000-0000-4000-8000-0000007d0003', role: UserRole.TEACHER },
  U: { id: '00000000-0000-4000-8000-0000007d0004', role: UserRole.TEACHER },
  EXECUTIVE: { id: '00000000-0000-4000-8000-0000007d0005', role: UserRole.EXECUTIVE },
  ACCOUNTANT: { id: '00000000-0000-4000-8000-0000007d0006', role: UserRole.ACCOUNTANT },
  OFFICE_STAFF: { id: '00000000-0000-4000-8000-0000007d0007', role: UserRole.OFFICE_STAFF },
  EXAM_CONTROLLER: { id: '00000000-0000-4000-8000-0000007d0008', role: UserRole.EXAM_CONTROLLER },
  COMMITTEE: { id: '00000000-0000-4000-8000-0000007d0009', role: UserRole.COMMITTEE },
  PARENT: { id: '00000000-0000-4000-8000-0000007d000a', role: UserRole.PARENT },
  STUDENT: { id: '00000000-0000-4000-8000-0000007d000b', role: UserRole.STUDENT },
  ADMIN2: { id: '00000000-0000-4000-8000-0000007d000c', role: UserRole.ADMIN },
} as const;
type Who = keyof typeof USERS;

/** The school's (Asia/Dhaka) calendar date `daysAgo` days back, as YYYY-MM-DD. */
function dhakaDate(daysAgo = 0): string {
  const d = new Date(Date.now() - daysAgo * 86400000);
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' });
}
function recentMonday(): string {
  for (let i = 0; i < 7; i++) {
    const s = dhakaDate(i);
    if (new Date(`${s}T00:00:00Z`).getUTCDay() === 1) return s;
  }
  throw new Error('unreachable');
}
function minusDays(date: string, n: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() - n * 86400000)
    .toISOString()
    .slice(0, 10);
}

describe('Lesson deliveries E2E (66.2.03)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const tokens: Record<string, string> = {};
  let adminToken: string;
  let subjectId: string;
  let periodId: string;
  let freePeriodId: string;
  let slotId: string;
  let teacherS: string;
  const monday = recentMonday();

  const email = (who: string) => `ld-e2e-${who.toLowerCase()}@e2e.example`;

  async function login(mail: string): Promise<string> {
    const res = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email: mail, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token;
  }

  function as(
    method: 'get' | 'post' | 'put',
    path: string,
    who: Who | 'ADMIN',
    tenant = SEED_TENANT_ID,
  ) {
    const token = who === 'ADMIN' ? adminToken : tokens[who];
    const role = who === 'ADMIN' ? UserRole.ADMIN : USERS[who].role;
    return supertest(app.getHttpServer())
      [method](`${API}${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', tenant)
      .set('X-Role', role);
  }

  async function makeTeacher(userId: string, tag: string): Promise<string> {
    const teacherId = randomUUID();
    await dataSource.query(
      `WITH sp AS (
         INSERT INTO staff_profiles (id, user_id, tenant_id, employee_id, created_at, updated_at)
         VALUES (gen_random_uuid(), $2::uuid, $3::uuid, 'EMP-LDE2E-' || $4, NOW(), NOW())
         ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
         RETURNING id
       )
       INSERT INTO teachers (id, user_id, employee_id, designations, tenant_id, staff_profile_id, created_at, updated_at)
       SELECT $1::uuid, $2::uuid, 'LDE2E-' || $4, '{}', $3::uuid, sp.id, NOW(), NOW() FROM sp`,
      [teacherId, userId, SEED_TENANT_ID, tag],
    );
    return teacherId;
  }

  const body = (date = monday, extra: object = {}) => ({
    section_id: SEED_SECTION_1_ID,
    subject_id: subjectId,
    date,
    period_slot_id: periodId,
    status: 'TAUGHT',
    ...extra,
  });

  beforeAll(async () => {
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
       VALUES ($1, 'Tenant Two', 'ld-e2e-tenant-two', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [TENANT_2],
    );
    for (const [who, u] of Object.entries(USERS)) {
      const tenant = who === 'ADMIN2' ? TENANT_2 : SEED_TENANT_ID;
      await dataSource.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [u.id, email(who), SEED_ADMIN_PASSWORD_HASH, `LD E2E ${who}`],
      );
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [u.id, tenant, u.role],
      );
      tokens[who] = await login(email(who));
    }
    adminToken = await login(SEED_ADMIN_EMAIL);
  }, 120000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // The school's "today" is its Dhaka date; the year must cover our dates.
    await dataSource.query(
      `UPDATE schools SET settings = COALESCE(settings, '{"version":1}'::jsonb)
         || '{"region":{"timezone":"Asia/Dhaka"}}'::jsonb WHERE id = $1`,
      [SEED_TENANT_ID],
    );
    await dataSource.query(
      'UPDATE academic_years SET start_date = $2, end_date = $3 WHERE id = $1',
      [SEED_ACADEMIC_YEAR_ID, '2020-01-01', '2099-12-31'],
    );
    subjectId = (
      await dataSource.query(
        `INSERT INTO subjects (id, tenant_id, name_en, code, created_at, updated_at)
         VALUES ($1, $2, 'LD E2E Maths', $3, NOW(), NOW()) RETURNING id`,
        [randomUUID(), SEED_TENANT_ID, `LD-${randomUUID().slice(0, 8)}`],
      )
    )[0].id;
    const teacherT = await makeTeacher(USERS.T.id, 'T');
    teacherS = await makeTeacher(USERS.S.id, 'S');
    await makeTeacher(USERS.U.id, 'U');

    const [{ id: shiftId }] = await dataSource.query(
      `INSERT INTO shifts (id, tenant_id, name, day_starts_at, day_ends_at, sequence, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, '08:00', '13:00', 0, NOW(), NOW()) RETURNING id`,
      [SEED_TENANT_ID, `LD E2E ${randomUUID().slice(0, 8)}`],
    );
    const period = async (seq: number) =>
      (
        await dataSource.query(
          `INSERT INTO period_slots (id, tenant_id, shift_id, sequence, kind, name, starts_at, ends_at, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, $3, 'CLASS', 'P', '08:00', '08:45', NOW(), NOW()) RETURNING id`,
          [SEED_TENANT_ID, shiftId, seq],
        )
      )[0].id as string;
    periodId = await period(1);
    freePeriodId = await period(2);
    // The section's class must sit on this shift for `extra` to accept the slot.
    await dataSource.query(
      `UPDATE classes SET shift_id = $2 WHERE id = (SELECT class_id FROM class_sections WHERE id = $1)`,
      [SEED_SECTION_1_ID, shiftId],
    );
    const [{ id: routineId }] = await dataSource.query(
      `INSERT INTO routines (id, tenant_id, academic_year_id, name, state, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, 'LD E2E', 'PUBLISHED', NOW(), NOW()) RETURNING id`,
      [SEED_TENANT_ID, SEED_ACADEMIC_YEAR_ID],
    );
    slotId = (
      await dataSource.query(
        `INSERT INTO routine_slots (id, tenant_id, routine_id, section_id, period_slot_id, weekday, subject_id, recurrence, valid_from, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, 1, $5, 'WEEKLY', '2020-01-01', NOW(), NOW()) RETURNING id`,
        [SEED_TENANT_ID, routineId, SEED_SECTION_1_ID, periodId, subjectId],
      )
    )[0].id;
    await dataSource.query(
      `INSERT INTO routine_slot_teachers (id, tenant_id, routine_slot_id, teacher_id, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, NOW())`,
      [SEED_TENANT_ID, slotId, teacherT],
    );
  });

  async function substituteS(date: string) {
    await dataSource.query(
      `INSERT INTO routine_substitutions (id, tenant_id, routine_slot_id, date, substitute_teacher_id, is_cancelled, created_by, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, false, $5, NOW(), NOW())`,
      [SEED_TENANT_ID, slotId, date, teacherS, USERS.S.id],
    );
  }

  describe('PUT /lesson-deliveries role matrix', () => {
    it('owner T is 200', async () => {
      await as('put', '/lesson-deliveries', 'T').send(body()).expect(200);
    });

    it('substitute S is 200 on the day they cover, and U (unrelated) is 403', async () => {
      await substituteS(monday);
      await as('put', '/lesson-deliveries', 'S').send(body()).expect(200);
      await as('put', '/lesson-deliveries', 'U').send(body()).expect(403);
    });

    it('ADMIN is 200', async () => {
      await as('put', '/lesson-deliveries', 'ADMIN').send(body()).expect(200);
    });

    it.each([
      'EXECUTIVE',
      'ACCOUNTANT',
      'OFFICE_STAFF',
      'EXAM_CONTROLLER',
      'COMMITTEE',
      'PARENT',
      'STUDENT',
    ] as const)('%s is 403', async (who) => {
      await as('put', '/lesson-deliveries', who).send(body()).expect(403);
    });
  });

  describe('GET /lesson-deliveries', () => {
    it('T sees the Monday period; ADMIN is 403; teacher=<uuid> is 400', async () => {
      const res = await as('get', `/lesson-deliveries?teacher=me&date=${monday}`, 'T').expect(200);
      expect(res.body.periods).toHaveLength(1);
      expect(res.body.periods[0].period_slot_id).toBe(periodId);
      await as('get', `/lesson-deliveries?teacher=me&date=${monday}`, 'ADMIN').expect(403);
      await as('get', `/lesson-deliveries?teacher=${randomUUID()}&date=${monday}`, 'T').expect(400);
    });
  });

  describe('POST today-all-taught and extra', () => {
    it('today-all-taught: T 200, U 200 (nothing to do), PARENT 403', async () => {
      await as('post', '/lesson-deliveries/today-all-taught', 'T').expect(200);
      await as('post', '/lesson-deliveries/today-all-taught', 'PARENT').expect(403);
    });

    it('extra: T 201, U 403, PARENT 403', async () => {
      const extra = {
        section_id: SEED_SECTION_1_ID,
        subject_id: subjectId,
        date: monday,
        period_slot_id: freePeriodId,
      };
      await as('post', '/lesson-deliveries/extra', 'U').send(extra).expect(403);
      await as('post', '/lesson-deliveries/extra', 'PARENT').send(extra).expect(403);
      await as('post', '/lesson-deliveries/extra', 'T').send(extra).expect(201);
    });
  });

  describe('D29 window through HTTP', () => {
    it('T on Monday-14 is 403 WINDOW_CLOSED; ADMIN on the same date is 200', async () => {
      const old = minusDays(monday, 14);
      const res = await as('put', '/lesson-deliveries', 'T').send(body(old)).expect(403);
      expect(JSON.stringify(res.body)).toContain('LESSON_DELIVERY_WINDOW_CLOSED');
      await as('put', '/lesson-deliveries', 'ADMIN').send(body(old)).expect(200);
    });
  });

  describe('date format', () => {
    it('a date-time string is 400 (cannot bypass the window)', async () => {
      await as('put', '/lesson-deliveries', 'T')
        .send(body(`${monday}T00:00:00Z`))
        .expect(400);
      await as('put', '/lesson-deliveries', 'T').send(body('2026-13-01')).expect(400);
    });
  });

  describe('tenant isolation and context', () => {
    it("tenant-2 admin cannot write tenant 1's section; no row appears", async () => {
      const res = await as('put', '/lesson-deliveries', 'ADMIN2', TENANT_2).send(body());
      expect([403, 422]).toContain(res.status);
      const rows = await dataSource.query(
        'SELECT 1 FROM lesson_deliveries WHERE tenant_id = $1 AND section_id = $2',
        [SEED_TENANT_ID, SEED_SECTION_1_ID],
      );
      expect(rows).toHaveLength(0);
    });

    it('a missing X-Tenant-ID is 401', async () => {
      await supertest(app.getHttpServer())
        .put(`${API}/lesson-deliveries`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(body())
        .expect(401);
    });
  });
});
