import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import {
  SEED_ACADEMIC_YEAR_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
  SEED_ADMIN_USER_ID,
  SEED_SECTION_1_ID,
  SEED_SECTION_2_ID,
  SEED_TENANT_ID,
} from '@test/constants';
import { seedPeriodRoutine } from '../attendance/attendance-periods.fixture';
import { RoutineSlot } from './entities/routine-slot.entity';

/**
 * [8.10.7.0-s2] `GET /routines/resolve` linkage guard.
 *
 * Cast: parent P is linked to student A (section 1) only; student user S *is*
 * student A; student B sits in section 2 and belongs to nobody we log in as.
 * Both sections have one slot in the same PUBLISHED routine.
 * The staff matrix reads section 1; the family cases try to reach B.
 */
const API = '/api/v1';
const FROM_TO = 'from=2026-10-04&to=2026-10-10';
const DAY = '2026-10-07'; // a Wednesday inside FROM_TO

const TENANT_2 = '00000000-0000-4000-8000-0000008a0001';
const TENANT_2_AY = '00000000-0000-4000-8000-0000008a0002';
const PARENT_ID = '00000000-0000-4000-8000-0000008a0010';
const STUDENT_USER_ID = '00000000-0000-4000-8000-0000008a0011';
const NONEXISTENT = '00000000-0000-4000-8000-0000008adead';

/** One login per staff role other than the seeded ADMIN. */
const STAFF_ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.EXECUTIVE,
  UserRole.TEACHER,
  UserRole.OFFICE_STAFF,
  UserRole.EXAM_CONTROLLER,
  UserRole.ACCOUNTANT,
  UserRole.COMMITTEE,
];
const roleUserId = (i: number) => `00000000-0000-4000-8000-0000008a01${String(i).padStart(2, '0')}`;
const roleEmail = (role: string) => `resolve-guard-${role.toLowerCase()}@e2e.example`;

describe('GET /routines/resolve family guard (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  const tokens: Record<string, string> = {};
  let studentA: string;
  let studentB: string;
  let sectionBSlotId: string;
  let sectionASlotId: string;
  let routineId: string;

  async function login(email: string): Promise<string> {
    const res = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token;
  }

  const get = (query: string, token: string, tenant: string | null = SEED_TENANT_ID) => {
    const req = supertest(app.getHttpServer())
      .get(`${API}/routines/resolve?${query}&${FROM_TO}`)
      .set('Authorization', `Bearer ${token}`);
    return tenant ? req.set('X-Tenant-ID', tenant) : req;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    ds = app.get(DataSource);

    await ds.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Resolve Guard Tenant 2', 'resolve-guard-tenant-2', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [TENANT_2],
    );
    await ds.query(
      `INSERT INTO academic_years (id, name, start_date, end_date, is_current, tenant_id, created_at, updated_at)
       VALUES ($1, 'T2 2026', '2026-01-01', '2026-12-31', true, $2, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [TENANT_2_AY, TENANT_2],
    );

    const accounts: Array<[string, string, UserRole]> = [
      [PARENT_ID, 'resolve-guard-parent@e2e.example', UserRole.PARENT],
      [STUDENT_USER_ID, 'resolve-guard-student@e2e.example', UserRole.STUDENT],
      ...STAFF_ROLES.map((r, i): [string, string, UserRole] => [roleUserId(i), roleEmail(r), r]),
    ];
    for (const [id, email, role] of accounts) {
      await ds.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'Resolve Guard', 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [id, email, SEED_ADMIN_PASSWORD_HASH],
      );
      await ds.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [id, SEED_TENANT_ID, role],
      );
      tokens[role] = await login(email);
    }
    // P also belongs to tenant 2; the seeded admin administers tenant 2.
    for (const [userId, role] of [
      [PARENT_ID, UserRole.PARENT],
      [SEED_ADMIN_USER_ID, UserRole.ADMIN],
    ] as const) {
      await ds.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [userId, TENANT_2, role],
      );
    }
    tokens[UserRole.ADMIN] = await login(SEED_ADMIN_EMAIL);
  }, 120000);

  afterAll(async () => {
    await app.close();
  });

  // The global beforeEach truncates students / guardians / routines, so rebuild them per test.
  beforeEach(async () => {
    const makeStudent = async (name: string, sectionId: string, userId: string | null) => {
      const rows = await ds.query(
        `INSERT INTO students
           (full_name, registration_number, roll_number, class_section_id, tenant_id,
            user_id, enrollment_status, preferred_communication, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', 'SMS', NOW(), NOW()) RETURNING id`,
        [
          name,
          `RG-${randomUUID().slice(0, 8)}`,
          Math.floor(Math.random() * 1000000),
          sectionId,
          SEED_TENANT_ID,
          userId,
        ],
      );
      // The resolver finds a student's section through their ACTIVE enrollment.
      await ds.query(
        `INSERT INTO enrollments (student_id, class_id, section_id, academic_year_id, enrollment_status,
                                  enrolled_at, tenant_id, created_at, updated_at)
         SELECT $1, class_id, id, $3, 'ACTIVE', NOW(), tenant_id, NOW(), NOW()
         FROM class_sections WHERE id = $2`,
        [rows[0].id, sectionId, SEED_ACADEMIC_YEAR_ID],
      );
      return rows[0].id as string;
    };
    studentA = await makeStudent('Student A', SEED_SECTION_1_ID, STUDENT_USER_ID);
    studentB = await makeStudent('Student B', SEED_SECTION_2_ID, null);
    const [{ id: guardianId }] = await ds.query(
      `INSERT INTO guardians (full_name, relationship, phone, email, tenant_id, user_id,
                              preferred_communication, is_primary_contact, created_at, updated_at)
       VALUES ('Parent P', 'FATHER', '+8801700000000', 'rg-p@e2e.example', $1, $2, 'SMS', true, NOW(), NOW())
       RETURNING id`,
      [SEED_TENANT_ID, PARENT_ID],
    );
    await ds.query(`INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)`, [
      studentA,
      guardianId,
    ]);

    const { slots } = await seedPeriodRoutine(ds, {
      tenantId: SEED_TENANT_ID,
      academicYearId: SEED_ACADEMIC_YEAR_ID,
      sectionId: SEED_SECTION_1_ID,
      date: DAY,
      periods: 1,
      createdBy: SEED_ADMIN_USER_ID,
    });
    sectionASlotId = slots[0].routineSlot.id;
    routineId = slots[0].routineSlot.routine_id;
    const { id: _id, ...copy } = slots[0].routineSlot;
    sectionBSlotId = (
      await ds.getRepository(RoutineSlot).save({ ...copy, section_id: SEED_SECTION_2_ID })
    ).id;
  });

  const slotIds = (res: supertest.Response) =>
    (res.body as Array<{ routine_slot_id: string }>).map((s) => s.routine_slot_id);

  describe('role matrix, ?section_id=A', () => {
    it.each([
      UserRole.SUPER_ADMIN,
      UserRole.ADMIN,
      UserRole.EXECUTIVE,
      UserRole.TEACHER,
      UserRole.OFFICE_STAFF,
      UserRole.EXAM_CONTROLLER,
    ])('%s gets 200 and the section slots', async (role) => {
      const res = await get(`section_id=${SEED_SECTION_1_ID}`, tokens[role]).expect(200);
      expect(slotIds(res)).toContain(sectionASlotId);
    });

    it.each([UserRole.PARENT, UserRole.STUDENT, UserRole.ACCOUNTANT, UserRole.COMMITTEE])(
      '%s gets 403',
      async (role) => {
        await get(`section_id=${SEED_SECTION_1_ID}`, tokens[role]).expect(403);
      },
    );
  });

  describe('family id manipulation', () => {
    it('P reads linked student A: A slots, never B', async () => {
      const res = await get(`student_id=${studentA}`, tokens[UserRole.PARENT]).expect(200);
      expect(slotIds(res)).toContain(sectionASlotId);
      expect(slotIds(res)).not.toContain(sectionBSlotId);
    });

    it('P reading unlinked student B gets 401 (the regression)', async () => {
      await get(`student_id=${studentB}`, tokens[UserRole.PARENT]).expect(401);
    });

    it('P with teacher_id gets 403', async () => {
      await get(`teacher_id=${randomUUID()}`, tokens[UserRole.PARENT]).expect(403);
    });

    it('S reads self 200, another student 401', async () => {
      await get(`student_id=${studentA}`, tokens[UserRole.STUDENT]).expect(200);
      await get(`student_id=${studentB}`, tokens[UserRole.STUDENT]).expect(401);
    });

    it('P with a nonexistent student id gets 401', async () => {
      await get(`student_id=${NONEXISTENT}`, tokens[UserRole.PARENT]).expect(401);
    });

    it('staff ADMIN may still look up any student', async () => {
      const res = await get(`student_id=${studentB}`, tokens[UserRole.ADMIN]).expect(200);
      expect(slotIds(res)).toContain(sectionBSlotId);
    });
  });

  describe('tenant isolation', () => {
    it("P in tenant 2 cannot read tenant 1's student A", async () => {
      await get(`student_id=${studentA}`, tokens[UserRole.PARENT], TENANT_2).expect(401);
    });

    it("tenant 2 ADMIN asking for tenant 1's section gets no slots", async () => {
      const res = await get(
        `section_id=${SEED_SECTION_1_ID}`,
        tokens[UserRole.ADMIN],
        TENANT_2,
      ).expect(200);
      expect(res.body).toEqual([]);
    });

    it('missing X-Tenant-ID is 401', async () => {
      await get(`student_id=${studentA}`, tokens[UserRole.PARENT], null).expect(401);
    });

    it('a tenant the caller is not a member of is 401', async () => {
      await get(`student_id=${studentA}`, tokens[UserRole.STUDENT], TENANT_2).expect(401);
    });
  });

  describe('GET /routines/:id/slots family scope [#3003]', () => {
    const getSlots = (id: string, token: string, tenant = SEED_TENANT_ID) =>
      supertest(app.getHttpServer())
        .get(`${API}/routines/${id}/slots`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', tenant);
    const ids = (res: supertest.Response) =>
      (res.body as Array<{ slot: { id: string } }>).map((s) => s.slot.id);

    it('P sees only the linked child section, never the whole school', async () => {
      const res = await getSlots(routineId, tokens[UserRole.PARENT]).expect(200);
      expect(ids(res)).toContain(sectionASlotId);
      expect(ids(res)).not.toContain(sectionBSlotId);
    });

    it('S sees only own section', async () => {
      const res = await getSlots(routineId, tokens[UserRole.STUDENT]).expect(200);
      expect(ids(res)).toContain(sectionASlotId);
      expect(ids(res)).not.toContain(sectionBSlotId);
    });

    it.each([UserRole.ADMIN, UserRole.TEACHER])('%s still sees every section', async (role) => {
      const res = await getSlots(routineId, tokens[role]).expect(200);
      expect(ids(res)).toEqual(expect.arrayContaining([sectionASlotId, sectionBSlotId]));
    });

    it("tenant 2 ADMIN asking for tenant 1's routine gets a fixed-text 404 that does not echo the id", async () => {
      const res = await getSlots(routineId, tokens[UserRole.ADMIN], TENANT_2).expect(404);
      expect(res.body.message).toBe('Routine not found');
      expect(res.body.message).not.toContain(routineId);
    });

    it('an unknown routine id gets the same fixed text', async () => {
      const res = await getSlots(NONEXISTENT, tokens[UserRole.PARENT]).expect(404);
      expect(res.body.message).toBe('Routine not found');
      expect(res.body.message).not.toContain(NONEXISTENT);
    });

    it('P with no linked student gets 200 []', async () => {
      await ds.query(`DELETE FROM student_guardians`);
      const res = await getSlots(routineId, tokens[UserRole.PARENT]).expect(200);
      expect(res.body).toEqual([]);
    });

    it('a non-UUID id is 400', async () => {
      await getSlots('not-a-uuid', tokens[UserRole.PARENT]).expect(400);
    });
  });
});
