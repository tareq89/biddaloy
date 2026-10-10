import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';
import { TENANT_STATUS_REDIS } from '../../schools/tenant-status.service';
import { TeacherAssignmentType, TeacherDesignation, UserRole } from '@biddaloy/shared';
import { AppModule } from '../../../app.module';
import { Teacher } from '../../academics/entities/teacher.entity';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import { AttentionScheduler } from '../engine/attention-scheduler';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
  SEED_ACADEMIC_YEAR_ID,
} from '@test/constants';

/**
 * E2E for /attention [67.1.07]. The seed admin user holds ADMIN (seed) plus
 * TEACHER and PARENT memberships, so one login can act as each role via X-Role.
 */
describe('Attention API E2E', () => {
  let app: INestApplication;
  let ds: DataSource;
  let token: string;
  let redis: Redis;
  let studentId: string;
  let sectionId: string;
  const extraMemberships: string[] = [];
  const classIds: string[] = [];
  const OTHER_USER = '00000000-0000-4000-8000-0000001e0701';

  const call = (
    method: 'get' | 'post',
    path: string,
    role: UserRole = UserRole.TEACHER,
    tenantId: string | null = SEED_TENANT_ID,
  ) => {
    let req = supertest(app.getHttpServer())
      [method](`/api/v1/attention${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Role', role);
    if (tenantId) req = req.set('X-Tenant-ID', tenantId);
    return req;
  };

  /** One alert + one recipient for `userId`; returns the recipient id. */
  async function add(severity: string, userId = SEED_ADMIN_USER_ID, studentRef?: string) {
    const [a] = await ds.query(
      `INSERT INTO alerts (tenant_id, rule_key, source, severity, category, dedupe_key, subject_type, subject_id)
       VALUES ($1, 'x.unknown', 'RULE', $2, 'ATTENDANCE', gen_random_uuid()::text, $3, $4) RETURNING id`,
      [SEED_TENANT_ID, severity, studentRef ? 'student' : null, studentRef ?? null],
    );
    const [r] = await ds.query(
      `INSERT INTO alert_recipients (tenant_id, alert_id, user_id, role) VALUES ($1, $2, $3, 'TEACHER') RETURNING id`,
      [SEED_TENANT_ID, a.id, userId],
    );
    return r.id as string;
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
    // The app's own BullMQ sweeps run every rule at the real clock (CI: Saturday 09:08 Dhaka) and
    // can resolve or add alerts between a fixture and a read. Only this file's fixtures may write.
    await app.get(AttentionScheduler).worker.close();
    ds = app.get(DataSource);
    redis = app.get(TENANT_STATUS_REDIS, { strict: false });

    for (const role of [UserRole.TEACHER, UserRole.PARENT]) {
      const rows = await ds.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING RETURNING id`,
        [SEED_ADMIN_USER_ID, SEED_TENANT_ID, role],
      );
      if (rows[0]) extraMemberships.push(rows[0].id);
    }
    await ds.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, 'other@attention-e2e.example', 'x', 'Other', 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [OTHER_USER],
    );
    await ds.query(`UPDATE academic_years SET is_current = false WHERE tenant_id = $1`, [
      SEED_TENANT_ID,
    ]);
    await ds.query(`UPDATE academic_years SET is_current = true WHERE id = $1`, [
      SEED_ACADEMIC_YEAR_ID,
    ]);
    const [klass] = await ds.query(
      `INSERT INTO classes (tenant_id, name, academic_year_id) VALUES ($1, 'Attn E2E', $2) RETURNING id`,
      [SEED_TENANT_ID, SEED_ACADEMIC_YEAR_ID],
    );
    classIds.push(klass.id);
    [{ id: sectionId }] = await ds.query(
      `INSERT INTO class_sections (tenant_id, class_id, section_name) VALUES ($1, $2, 'A') RETURNING id`,
      [SEED_TENANT_ID, klass.id],
    );
    token = (
      await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200)
    ).body.access_token;
  }, 60_000);

  // alerts/recipients and teachers are truncated or cleaned per test; start clean.
  beforeEach(async () => {
    await ds.query(`DELETE FROM alerts WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    const keys = await redis.keys(`tenant:${SEED_TENANT_ID}:attention:summary:*`);
    if (keys.length) await redis.del(...keys);
    // students are truncated between tests, so that fixture is rebuilt each time.
    [{ id: studentId }] = await ds.query(
      `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id)
       VALUES ('Attn Student', $1, 9981, $2, $3) RETURNING id`,
      [`ATTN-${Date.now()}`, sectionId, SEED_TENANT_ID],
    );
    await ds.query(
      `INSERT INTO enrollments (student_id, class_id, section_id, academic_year_id, tenant_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
      [studentId, classIds[0], sectionId, SEED_ACADEMIC_YEAR_ID, SEED_TENANT_ID],
    );
  });

  afterAll(async () => {
    await ds.query(`DELETE FROM alerts WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await ds.query(`DELETE FROM enrollments WHERE student_id = $1`, [studentId]);
    await ds.query(`DELETE FROM students WHERE id = $1`, [studentId]);
    await ds.query(`DELETE FROM class_sections WHERE id = $1`, [sectionId]);
    await ds.query(`DELETE FROM classes WHERE id = ANY($1)`, [classIds]);
    if (extraMemberships.length) {
      await ds.query(`DELETE FROM user_tenants WHERE id = ANY($1)`, [extraMemberships]);
    }
    await ds.query(`DELETE FROM users WHERE id = $1`, [OTHER_USER]);
    await app.close();
  });

  describe('auth and tenant context', () => {
    it('401 without a token', async () => {
      await supertest(app.getHttpServer()).get('/api/v1/attention/summary').expect(401);
    });

    it('401 when X-Tenant-ID is missing or names a tenant the user is not in', async () => {
      await call('get', '/summary', UserRole.TEACHER, null).expect(401);
      await call(
        'get',
        '/summary',
        UserRole.TEACHER,
        '00000000-0000-4000-8000-000000000fff',
      ).expect(401);
    });

    it("403 reading another role's bar", async () => {
      await call('get', '/summary?role=ADMIN').expect(403);
    });
  });

  describe('own items', () => {
    it('summary counts match inserted rows; hide moves the item out of the bar into the worklist as HIDDEN', async () => {
      await add('CRITICAL');
      const warning = await add('WARNING');
      expect((await call('get', '/summary').expect(200)).body).toMatchObject({
        critical: 1,
        warning: 1,
        reminder: 0,
        activeTotal: 2,
      });

      const hidden = await call('post', `/items/${warning}/hide`).expect(200);
      expect(hidden.body.state).toBe('HIDDEN');

      // Hiding invalidated the cache: the bar drops it, the badge keeps it.
      expect((await call('get', '/summary').expect(200)).body).toMatchObject({
        warning: 0,
        activeTotal: 2,
      });
      const list = (await call('get', '/items?tab=active').expect(200)).body;
      expect(list.total).toBe(2);
      expect(list.items.find((i: { recipientId: string }) => i.recipientId === warning).state).toBe(
        'HIDDEN',
      );
    });

    it("404 hiding someone else's recipient; 400 hiding a CRITICAL", async () => {
      const theirs = await add('WARNING', OTHER_USER);
      await call('post', `/items/${theirs}/hide`).expect(404);
      const crit = await add('CRITICAL');
      await call('post', `/items/${crit}/hide`).expect(400);
    });

    it('400 on bad bodies: 101 seen ids, snooze DATE without date', async () => {
      const ids = Array.from({ length: 101 }, () => '11111111-1111-4111-8111-111111111111');
      await call('post', '/items/seen').send({ recipientIds: ids }).expect(400);
      const id = await add('WARNING');
      await call('post', `/items/${id}/snooze`).send({ choice: 'DATE' }).expect(400);
    });

    it('seen marks only own rows', async () => {
      const mine = await add('WARNING');
      const theirs = await add('WARNING', OTHER_USER);
      const res = await call('post', '/items/seen')
        .send({ recipientIds: [mine, theirs] })
        .expect(200);
      expect(res.body).toEqual({ updated: 1 });
    });
  });

  describe('GET /attention/students/:studentId', () => {
    const teacherFor = async (type?: TeacherAssignmentType) => {
      const teacher = await ds.getRepository(Teacher).save({
        user_id: SEED_ADMIN_USER_ID,
        employee_id: `EMP-ATTN-${Math.random().toString(36).slice(2, 8)}`,
        tenant_id: SEED_TENANT_ID,
        designations: [TeacherDesignation.CLASS_TEACHER],
      });
      if (type) {
        await ds.query(
          `INSERT INTO teacher_class_sections (teacher_id, section_id, tenant_id, assignment_type)
           VALUES ($1, $2, $3, $4)`,
          [teacher.id, sectionId, SEED_TENANT_ID, type],
        );
      }
    };

    it('403 for PARENT', async () => {
      await call('get', `/students/${studentId}`, UserRole.PARENT).expect(403);
    });

    it('403 for a TEACHER not assigned to the student section', async () => {
      await teacherFor();
      await call('get', `/students/${studentId}`, UserRole.TEACHER).expect(403);
    });

    it("200 for the section's CLASS_TEACHER and for ADMIN", async () => {
      await teacherFor(TeacherAssignmentType.CLASS_TEACHER);
      await add('WARNING', SEED_ADMIN_USER_ID, studentId);
      const teacher = await call('get', `/students/${studentId}`, UserRole.TEACHER).expect(200);
      expect(teacher.body).toHaveLength(1);
      await call('get', `/students/${studentId}`, UserRole.ADMIN).expect(200);
    });

    it('404 for an unknown student', async () => {
      await call('get', '/students/00000000-0000-4000-8000-000000000abc', UserRole.ADMIN).expect(
        404,
      );
    });
  });
});
