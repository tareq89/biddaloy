import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
  SEED_SECTION_1_ID,
  SEED_CLASS_1_ID,
} from '@test/constants';

/**
 * [8.10.7.4.14] `GET /students/:studentId/homework` (family-only).
 *
 * Ownership matches `family-read-api.e2e-spec.ts`: an unlinked child is refused with
 * the 401 `FamilyAccessService.assertLinked` throws (same as `GET /attendance/students/:id/summary`).
 * Staff roles never reach the handler: `@Roles(PARENT, STUDENT)` answers 403.
 */
const API = '/api/v1';
const ID = (n: number) => `00000000-0000-4000-8000-00000189500${n}`;
const TENANT_B = '00000000-0000-4000-8000-0000018950b1';

const PARENT_ID = ID(1); // linked to child A only
const STUDENT_ID = ID(2); // is child S
const STRANGER_ID = ID(3); // other family: linked to child B only
const STAFF_ROLES = [
  UserRole.ADMIN,
  UserRole.EXECUTIVE,
  UserRole.ACCOUNTANT,
  UserRole.TEACHER,
  UserRole.OFFICE_STAFF,
  UserRole.EXAM_CONTROLLER,
  UserRole.COMMITTEE,
];
const staffUserId = (i: number) => `00000000-0000-4000-8000-00000189501${i}`;

describe('[8.10.7.4.14] GET /students/:studentId/homework', () => {
  let app: INestApplication;
  let ds: DataSource;
  const tokens: Record<string, string> = {};
  let childA: string;
  let childB: string;
  let childS: string;
  let childDeleted: string;
  let childInOtherTenant: string;
  let hwA: string; // assignment on childA's section, due far ahead
  let subjectId: string;

  const http = () => supertest(app.getHttpServer());
  const get = (token: string, studentId: string, tenantId: string | null = SEED_TENANT_ID) => {
    const r = http()
      .get(`${API}/students/${studentId}/homework`)
      .set('Authorization', `Bearer ${token}`);
    return tenantId === null ? r : r.set('X-Tenant-ID', tenantId);
  };

  async function login(email: string): Promise<string> {
    const res = await http()
      .post(`${API}/auth/login`)
      .send({ email, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token;
  }

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
       VALUES ($1, 'Hw Family B', 'hw-family-b', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [TENANT_B],
    );
    const users: Array<[string, UserRole, string]> = [
      [PARENT_ID, UserRole.PARENT, 'parent'],
      [STUDENT_ID, UserRole.STUDENT, 'student'],
      [STRANGER_ID, UserRole.PARENT, 'stranger'],
      ...STAFF_ROLES.map((r, i): [string, UserRole, string] => [
        staffUserId(i),
        r,
        r.toLowerCase(),
      ]),
    ];
    for (const [id, role, key] of users) {
      const email = `hw-family-${key}@e2e.example`;
      await ds.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [id, email, SEED_ADMIN_PASSWORD_HASH, `Hw ${key}`],
      );
      await ds.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [id, SEED_TENANT_ID, role],
      );
      tokens[key] = await login(email);
    }
    // The parent also belongs to tenant B (a real second membership), but is not linked there.
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, 'PARENT', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [PARENT_ID, TENANT_B],
    );
  }, 120000);

  afterAll(async () => {
    await app.close();
  });

  // test/setup.ts truncates transactional tables before every test, so rebuild them here.
  beforeEach(async () => {
    const mk = async (name: string, tenant = SEED_TENANT_ID, userId: string | null = null) =>
      (
        await ds.query(
          `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id,
             user_id, enrollment_status, preferred_communication, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', 'SMS', NOW(), NOW()) RETURNING id`,
          [
            name,
            `HF-${Math.random().toString(36).slice(2, 12)}`,
            Math.floor(Math.random() * 1000000),
            SEED_SECTION_1_ID,
            tenant,
            userId,
          ],
        )
      )[0].id as string;
    childA = await mk('Child A');
    childB = await mk('Child B');
    childS = await mk('Child S', SEED_TENANT_ID, STUDENT_ID);
    childDeleted = await mk('Child Deleted');
    await ds.query(`UPDATE students SET deleted_at = NOW() WHERE id = $1`, [childDeleted]);
    // Tenant B student reuses the seed section id on purpose is NOT possible (FK tenant), so
    // a student row with tenant_id B pointing at tenant A's section models "wrong tenant" data.
    childInOtherTenant = await mk('Child In B', TENANT_B);

    const guardian = async (userId: string, name: string) =>
      (
        await ds.query(
          `INSERT INTO guardians (full_name, relationship, phone, email, tenant_id, user_id,
             preferred_communication, is_primary_contact, created_at, updated_at)
           VALUES ($1, 'FATHER', '+8801700000000', $2, $3, $4, 'SMS', true, NOW(), NOW()) RETURNING id`,
          [name, `${name}@hw-family.example`, SEED_TENANT_ID, userId],
        )
      )[0].id as string;
    const link = (g: string, s: string) =>
      ds.query(`INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)`, [s, g]);
    const gp = await guardian(PARENT_ID, 'hwparent');
    const gs = await guardian(STRANGER_ID, 'hwstranger');
    await link(gp, childA);
    await link(gp, childDeleted);
    await link(gs, childB);

    subjectId = (
      await ds.query(
        `INSERT INTO subjects (tenant_id, name_en, name_bn, code, created_at, updated_at)
         VALUES ($1, 'Mathematics', 'গণিত', $2, NOW(), NOW()) RETURNING id`,
        [SEED_TENANT_ID, `HF${Math.random().toString(36).slice(2, 7)}`],
      )
    )[0].id as string;
    hwA = await assignHomework('Section homework', '2099-01-01');
  });

  async function assignHomework(title: string, due: string, assigned = '2000-01-01') {
    const hw = (
      await ds.query(
        `INSERT INTO homework (tenant_id, subject_id, class_id, title, grading_mode, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'MARKS', NOW(), NOW()) RETURNING id`,
        [SEED_TENANT_ID, subjectId, SEED_CLASS_1_ID, title],
      )
    )[0].id as string;
    return (
      await ds.query(
        `INSERT INTO homework_assignments (tenant_id, homework_id, section_id, assigned_date, due_date, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'ACTIVE', NOW(), NOW()) RETURNING id`,
        [SEED_TENANT_ID, hw, SEED_SECTION_1_ID, assigned, due],
      )
    )[0].id as string;
  }

  describe('family callers', () => {
    it('PARENT reads a linked child: 200 with the documented shape', async () => {
      const res = await get(tokens.parent, childA).expect(200);
      expect(Object.keys(res.body).sort()).toEqual(['items', 'today']);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toMatchObject({
        assignment_id: hwA,
        title: 'Section homework',
        subject_name_en: 'Mathematics',
        subject_name_bn: 'গণিত',
        due_date: '2099-01-01',
      });
    });

    it('STUDENT reads their own record: 200', async () => {
      const res = await get(tokens.student, childS).expect(200);
      expect(res.body.items.map((i: { assignment_id: string }) => i.assignment_id)).toEqual([hwA]);
    });

    it('STUDENT cannot read another student: 401, same as assertLinked everywhere else', async () => {
      await get(tokens.student, childA).expect(401);
    });

    it('PARENT of child A cannot read child B (other family): 401, no body about B', async () => {
      const res = await get(tokens.parent, childB).expect(401);
      expect(JSON.stringify(res.body)).not.toContain('Section homework');
    });

    it('the other family cannot read child A either', async () => {
      await get(tokens.stranger, childA).expect(401);
      await get(tokens.stranger, childB).expect(200);
    });

    it('same status as the existing family endpoint for an unlinked child', async () => {
      const ref = await http()
        .get(`${API}/attendance/students/${childB}/summary`)
        .set('Authorization', `Bearer ${tokens.parent}`)
        .set('X-Tenant-ID', SEED_TENANT_ID);
      const res = await get(tokens.parent, childB);
      expect(res.status).toBe(ref.status);
    });

    it('soft-deleted (withdrawn from the register) linked child: refused like every family route', async () => {
      await get(tokens.parent, childDeleted).expect(401);
    });

    it('non-UUID id: 400', async () => {
      await get(tokens.parent, 'not-a-uuid').expect(400);
    });

    it('unknown child id: 401 (nothing is linked, nothing leaks)', async () => {
      await get(tokens.parent, ID(9)).expect(401);
    });
  });

  describe('one explicit it per staff role (family-only route)', () => {
    it('ADMIN gets 403', async () => {
      await get(tokens.admin, childA).expect(403);
    });
    it('EXECUTIVE gets 403', async () => {
      await get(tokens.executive, childA).expect(403);
    });
    it('ACCOUNTANT gets 403', async () => {
      await get(tokens.accountant, childA).expect(403);
    });
    it('TEACHER gets 403', async () => {
      await get(tokens.teacher, childA).expect(403);
    });
    it('OFFICE_STAFF gets 403', async () => {
      await get(tokens.office_staff, childA).expect(403);
    });
    it('EXAM_CONTROLLER gets 403', async () => {
      await get(tokens.exam_controller, childA).expect(403);
    });
    it('COMMITTEE gets 403', async () => {
      await get(tokens.committee, childA).expect(403);
    });
    it('no token gets 401', async () => {
      await http()
        .get(`${API}/students/${childA}/homework`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(401);
    });
  });

  describe('tenant context', () => {
    it('missing X-Tenant-ID is refused', async () => {
      const res = await get(tokens.parent, childA, null);
      expect(res.status).toBe(401);
    });

    it('invalid X-Tenant-ID is refused', async () => {
      const res = await get(tokens.parent, childA, 'not-a-uuid');
      expect(res.status).toBe(401);
    });

    it('a tenant the caller does not belong to is refused', async () => {
      const res = await get(tokens.stranger, childA, TENANT_B);
      expect(res.status).toBe(401); // ContextGuard: no membership in that tenant
    });

    it('cross-tenant: parent with a real tenant-B membership, asking tenant B for a tenant A child, gets nothing', async () => {
      const res = await get(tokens.parent, childA, TENANT_B);
      expect(res.status).toBe(401); // not linked inside tenant B
    });

    it('cross-tenant: a tenant-B student id asked under tenant A is refused', async () => {
      await get(tokens.parent, childInOtherTenant).expect(401);
    });
  });

  describe('school-local "today"', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('Dhaka midnight: 18:30Z on 6 Oct is 7 Oct locally, so a homework due 6 Oct is gone', async () => {
      const stale = await assignHomework('due 6 Oct', '2026-10-06', '2026-10-01');
      const fresh = await assignHomework('due 7 Oct', '2026-10-07', '2026-10-01');
      // Tokens already exist; faking only Date leaves timers and the DB driver alone.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-06T18:30:00Z'));
      const res = await get(tokens.parent, childA).expect(200);
      vi.useRealTimers();
      expect(res.body.today).toBe('2026-10-07');
      const got = res.body.items.map((i: { assignment_id: string }) => i.assignment_id);
      expect(got).toContain(fresh);
      expect(got).not.toContain(stale);
    });
  });
});
