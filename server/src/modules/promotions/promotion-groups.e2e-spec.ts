import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TeacherAssignmentType, TeacherDesignation, UserRole } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { Teacher } from '../academics/entities/teacher.entity';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
  SEED_ACADEMIC_YEAR_ID,
} from '@test/constants';

/**
 * E2E for `GET|PATCH /promotions/:id/groups` [69.4.01]: the groups step of a draft promotion run.
 * The seed admin user doubles as the teacher (TEACHER membership plus a `teachers` row), the same
 * way `my-class.e2e-spec.ts` does it; the role the request acts as is chosen with `X-Role`.
 */
const API = '/api/v1';
const GROUPS = ['Science', 'Arts'];

describe('Promotion groups E2E (69.4.01)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;
  let teacherId: string;
  const membershipIds: string[] = [];
  let originalOrganisation: unknown;
  let seq = 0;

  const call = (
    method: 'get' | 'patch',
    path: string,
    role: UserRole,
    headers: Record<string, string> = {},
  ) => {
    let req = supertest(app.getHttpServer())
      [method](`${API}${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .set('X-Role', role);
    for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
    return req;
  };

  /**
   * One DRAFT run on the seed (current, open) year, or on a closed year: two sections A and B, one
   * student each, a PUBLISHED exam where A's student scored 90 in the subject and B's scored 40.
   */
  async function seedRun(opts: { closedYear?: boolean } = {}) {
    seq += 1;
    const tag = `${process.pid}${Date.now() % 100000}${seq}`;
    let yearId = SEED_ACADEMIC_YEAR_ID;
    if (opts.closedYear) {
      const [y] = await dataSource.query(
        `INSERT INTO academic_years (name, start_date, end_date, is_current, closed_at, tenant_id, created_at, updated_at)
         VALUES ($1, '2001-01-01', '2001-12-31', false, NOW(), $2, NOW(), NOW()) RETURNING id`,
        [`PG closed ${tag}`, SEED_TENANT_ID],
      );
      yearId = y.id;
    }
    const [target] = await dataSource.query(
      `INSERT INTO academic_years (name, start_date, end_date, is_current, tenant_id, created_at, updated_at)
       VALUES ($1, '2090-01-01', '2090-12-31', false, $2, NOW(), NOW()) RETURNING id`,
      [`PG target ${tag}`, SEED_TENANT_ID],
    );
    const klass = async (name: string, grade: number, year: string) =>
      (
        await dataSource.query(
          `INSERT INTO classes (name, numeric_grade, academic_year_id, tenant_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING id`,
          [`${name} ${tag}`, grade, year, SEED_TENANT_ID],
        )
      )[0].id as string;
    const section = async (classId: string, name: string) =>
      (
        await dataSource.query(
          `INSERT INTO class_sections (class_id, section_name, tenant_id, created_at, updated_at)
           VALUES ($1, $2, $3, NOW(), NOW()) RETURNING id`,
          [classId, name, SEED_TENANT_ID],
        )
      )[0].id as string;
    const sourceClass = await klass('PG src', 5, yearId);
    const targetClass = await klass('PG tgt', 6, target.id);
    const sectionA = await section(sourceClass, 'A');
    const sectionB = await section(sourceClass, 'B');
    await section(targetClass, 'A');

    const [run] = await dataSource.query(
      `INSERT INTO promotion_runs (tenant_id, source_class_id, source_academic_year_id, target_academic_year_id, target_class_id, exam_ids, algorithm, status, refreshed_at, override_count, created_by_user_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, '{}', 'BLOCK', 'DRAFT', NOW(), 0, $6, NOW(), NOW()) RETURNING id`,
      [SEED_TENANT_ID, sourceClass, yearId, target.id, targetClass, SEED_ADMIN_USER_ID],
    );
    // One default scale per year: a second run in the same test reuses it.
    const [scale] = (
      await dataSource.query(
        `SELECT id FROM grading_scales WHERE academic_year_id = $1 AND tenant_id = $2 LIMIT 1`,
        [yearId, SEED_TENANT_ID],
      )
    ).concat(
      await dataSource.query(
        `INSERT INTO grading_scales (name, revision, academic_year_id, tenant_id, created_at, updated_at)
         SELECT 'PG scale', 1, $1, $2, NOW(), NOW()
          WHERE NOT EXISTS (SELECT 1 FROM grading_scales WHERE academic_year_id = $1 AND tenant_id = $2)
         RETURNING id`,
        [yearId, SEED_TENANT_ID],
      ),
    );
    const [exam] = await dataSource.query(
      `INSERT INTO exams (academic_year_id, class_id, name, kind, status, published_at, tenant_id, created_at, updated_at)
       VALUES ($1, $2, 'PG exam', 'TERM', 'PUBLISHED', NOW(), $3, NOW(), NOW()) RETURNING id`,
      [yearId, sourceClass, SEED_TENANT_ID],
    );
    const subjectCode = `PG${tag}`;
    const [subject] = await dataSource.query(
      `INSERT INTO subjects (tenant_id, name_en, code) VALUES ($1, 'PG Subject', $2) RETURNING id`,
      [SEED_TENANT_ID, subjectCode],
    );

    const people: Array<{ sectionId: string; marks: number; gpa: number }> = [
      { sectionId: sectionA, marks: 90, gpa: 5 },
      { sectionId: sectionB, marks: 40, gpa: 2 },
    ];
    const entryIds: string[] = [];
    let rank = 0;
    for (const p of people) {
      rank += 1;
      const [student] = await dataSource.query(
        `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id, date_of_birth, preferred_communication, enrollment_status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, '2015-01-01', 'SMS', 'ACTIVE', NOW(), NOW()) RETURNING id`,
        [`PG Student ${rank}`, `PG-${tag}-${rank}`, rank, p.sectionId, SEED_TENANT_ID],
      );
      const [enrollment] = await dataSource.query(
        `INSERT INTO enrollments (student_id, class_id, section_id, academic_year_id, tenant_id, enrollment_status, enrolled_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'ACTIVE', NOW(), NOW(), NOW()) RETURNING id`,
        [student.id, sourceClass, p.sectionId, yearId, SEED_TENANT_ID],
      );
      const [entry] = await dataSource.query(
        `INSERT INTO promotion_entries (tenant_id, run_id, student_id, source_enrollment_id, source_section_id, merit_rank, mean_gpa, total_marks_sum, passed_all, suggested_outcome, final_outcome, is_override, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, 'PROMOTE', 'PROMOTE', false, NOW(), NOW()) RETURNING id`,
        [SEED_TENANT_ID, run.id, student.id, enrollment.id, p.sectionId, rank, p.gpa, p.marks],
      );
      entryIds.push(entry.id);
      const [result] = await dataSource.query(
        `INSERT INTO results (exam_id, student_id, section_id, total_marks, gpa, grade, position, section_position, is_fail, grading_scale_id, grading_scale_revision, rule_version, computed_at, tenant_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'A', $6, 1, false, $7, 1, 'nctb-v1', NOW(), $8, NOW(), NOW()) RETURNING id`,
        [exam.id, student.id, p.sectionId, p.marks, p.gpa, rank, scale.id, SEED_TENANT_ID],
      );
      await dataSource.query(
        `INSERT INTO result_subjects (result_id, subject_id, obtained, grade, gpa, is_fail, is_fourth_subject, tenant_id, created_at, updated_at)
         VALUES ($1, $2, $3, 'A', $4, false, false, $5, NOW(), NOW())`,
        [result.id, subject.id, p.marks, p.gpa, SEED_TENANT_ID],
      );
    }
    return {
      runId: run.id as string,
      entryA: entryIds[0],
      entryB: entryIds[1],
      sectionA,
      subjectCode,
    };
  }

  async function makeTeacherOf(sectionId: string) {
    await dataSource.query(
      `INSERT INTO teacher_class_sections (tenant_id, teacher_id, section_id, assignment_type)
       VALUES ($1, $2, $3, $4)`,
      [SEED_TENANT_ID, teacherId, sectionId, TeacherAssignmentType.CLASS_TEACHER],
    );
  }

  const groupOf = async (entryId: string): Promise<string | null> =>
    (await dataSource.query(`SELECT group_name FROM promotion_entries WHERE id = $1`, [entryId]))[0]
      .group_name;

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
    dataSource = app.get(DataSource);

    // TEACHER for the homeroom cases, PARENT for the "no permission" 403 cases.
    for (const role of [UserRole.TEACHER, UserRole.PARENT]) {
      const inserted = await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING RETURNING id`,
        [SEED_ADMIN_USER_ID, SEED_TENANT_ID, role],
      );
      if (inserted[0]?.id) membershipIds.push(inserted[0].id);
    }
    // Homeroom sections only count in the tenant's current academic year.
    await dataSource.query(`UPDATE academic_years SET is_current = false WHERE tenant_id = $1`, [
      SEED_TENANT_ID,
    ]);
    await dataSource.query(`UPDATE academic_years SET is_current = true WHERE id = $1`, [
      SEED_ACADEMIC_YEAR_ID,
    ]);
    const [school] = await dataSource.query(`SELECT settings FROM schools WHERE id = $1`, [
      SEED_TENANT_ID,
    ]);
    originalOrganisation = school.settings?.organisation ?? null;
    await setGroups(GROUPS);

    const res = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    token = res.body.access_token;
  }, 60000);

  async function setGroups(groups: string[]) {
    await dataSource.query(
      `UPDATE schools SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object('organisation', jsonb_build_object('shifts', '[]'::jsonb, 'versions', '[]'::jsonb, 'groups', $2::jsonb)) WHERE id = $1`,
      [SEED_TENANT_ID, JSON.stringify(groups)],
    );
  }

  // `teachers` / `teacher_class_sections` / exams are truncated before every test (test/setup.ts).
  beforeEach(async () => {
    await setGroups(GROUPS);
    const teacher = await dataSource.getRepository(Teacher).save({
      user_id: SEED_ADMIN_USER_ID,
      employee_id: `EMP-PG-${Math.random().toString(36).slice(2, 8)}`,
      tenant_id: SEED_TENANT_ID,
      designations: [TeacherDesignation.CLASS_TEACHER],
    });
    teacherId = teacher.id;
  });

  afterAll(async () => {
    if (membershipIds.length) {
      await dataSource.query(`DELETE FROM user_tenants WHERE id = ANY($1)`, [membershipIds]);
    }
    await dataSource.query(
      `UPDATE schools SET settings = CASE WHEN $2::jsonb IS NULL THEN settings - 'organisation' ELSE jsonb_set(settings, '{organisation}', $2::jsonb) END WHERE id = $1`,
      [SEED_TENANT_ID, originalOrganisation === null ? null : JSON.stringify(originalOrganisation)],
    );
    await app.close();
  });

  describe('GET /promotions/:id/groups', () => {
    it('ADMIN sees every entry with the result and its source', async () => {
      const { runId, subjectCode } = await seedRun();

      const res = await call('get', `/promotions/${runId}/groups`, UserRole.ADMIN).expect(200);

      expect(res.body.total).toBe(2);
      expect(res.body.data[0].result).toEqual({
        gpa: 5,
        subjects: [{ subject_code: subjectCode, marks: 90, grade: 'A' }],
        source: 'EXAM',
      });
    });

    it('filters marks_min on a subject code on the server', async () => {
      const { runId, subjectCode, entryA } = await seedRun();

      const res = await call(
        'get',
        `/promotions/${runId}/groups?subject_code=${subjectCode}&marks_min=60`,
        UserRole.ADMIN,
      ).expect(200);

      expect(res.body.data.map((e: { entry_id: string }) => e.entry_id)).toEqual([entryA]);
    });

    it('filters gpa_max and rejects marks_min without a subject_code', async () => {
      const { runId, entryB } = await seedRun();

      const res = await call('get', `/promotions/${runId}/groups?gpa_max=3`, UserRole.ADMIN).expect(
        200,
      );
      expect(res.body.data.map((e: { entry_id: string }) => e.entry_id)).toEqual([entryB]);

      await call('get', `/promotions/${runId}/groups?marks_min=60`, UserRole.ADMIN).expect(400);
    });

    it('rejects gpa_min above gpa_max with 400', async () => {
      const { runId } = await seedRun();
      await call('get', `/promotions/${runId}/groups?gpa_min=4&gpa_max=3`, UserRole.ADMIN).expect(
        400,
      );
    });

    it('rejects a limit above 100 with 400', async () => {
      const { runId } = await seedRun();
      await call('get', `/promotions/${runId}/groups?limit=101`, UserRole.ADMIN).expect(400);
    });

    it('TEACHER with the homeroom of section A sees only A', async () => {
      const { runId, entryA, sectionA } = await seedRun();
      await makeTeacherOf(sectionA);

      const res = await call('get', `/promotions/${runId}/groups`, UserRole.TEACHER).expect(200);

      expect(res.body.data.map((e: { entry_id: string }) => e.entry_id)).toEqual([entryA]);
    });

    it('TEACHER without a homeroom gets an empty list', async () => {
      const { runId } = await seedRun();

      const res = await call('get', `/promotions/${runId}/groups`, UserRole.TEACHER).expect(200);

      expect(res.body).toEqual({ data: [], total: 0, page: 1, limit: 50 });
    });

    it('TEACHER whose homeroom has no entry in the run gets 404', async () => {
      const first = await seedRun();
      const other = await seedRun();
      await makeTeacherOf(other.sectionA);

      await call('get', `/promotions/${first.runId}/groups`, UserRole.TEACHER).expect(404);
    });

    it('PARENT gets 403', async () => {
      const { runId } = await seedRun();
      await call('get', `/promotions/${runId}/groups`, UserRole.PARENT).expect(403);
    });

    it('non-UUID run id is 400', async () => {
      await call('get', `/promotions/not-a-uuid/groups`, UserRole.ADMIN).expect(400);
    });

    it('rejects a missing and an invalid X-Tenant-ID', async () => {
      const { runId } = await seedRun();
      const noTenant = await supertest(app.getHttpServer())
        .get(`${API}/promotions/${runId}/groups`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Role', UserRole.ADMIN);
      expect([400, 401, 403]).toContain(noTenant.status);

      const badTenant = await call('get', `/promotions/${runId}/groups`, UserRole.ADMIN, {
        'X-Tenant-ID': 'not-a-uuid',
      });
      expect([400, 401, 403]).toContain(badTenant.status);
    });
  });

  describe('PATCH /promotions/:id/groups', () => {
    it('ADMIN sets a group on many entries', async () => {
      const { runId, entryA, entryB } = await seedRun();

      const res = await call('patch', `/promotions/${runId}/groups`, UserRole.ADMIN)
        .send({ entry_ids: [entryA, entryB], group_name: 'Science' })
        .expect(200);

      expect(res.body).toEqual({ updated: 2 });
      expect(await groupOf(entryA)).toBe('Science');
      expect(await groupOf(entryB)).toBe('Science');
    });

    it('null clears the group', async () => {
      const { runId, entryA } = await seedRun();
      await call('patch', `/promotions/${runId}/groups`, UserRole.ADMIN)
        .send({ entry_ids: [entryA], group_name: 'Arts' })
        .expect(200);

      await call('patch', `/promotions/${runId}/groups`, UserRole.ADMIN)
        .send({ entry_ids: [entryA], group_name: null })
        .expect(200);

      expect(await groupOf(entryA)).toBeNull();
    });

    it("TEACHER cannot set a group on another section's entries: 404, nothing updated", async () => {
      const { runId, entryA, entryB, sectionA } = await seedRun();
      await makeTeacherOf(sectionA);

      await call('patch', `/promotions/${runId}/groups`, UserRole.TEACHER)
        .send({ entry_ids: [entryB], group_name: 'Science' })
        .expect(404);
      // A mixed list is refused as a whole.
      await call('patch', `/promotions/${runId}/groups`, UserRole.TEACHER)
        .send({ entry_ids: [entryA, entryB], group_name: 'Science' })
        .expect(404);

      expect(await groupOf(entryA)).toBeNull();
      expect(await groupOf(entryB)).toBeNull();
    });

    it('TEACHER sets a group on their own section', async () => {
      const { runId, entryA, sectionA } = await seedRun();
      await makeTeacherOf(sectionA);

      const res = await call('patch', `/promotions/${runId}/groups`, UserRole.TEACHER)
        .send({ entry_ids: [entryA], group_name: 'Arts' })
        .expect(200);

      expect(res.body).toEqual({ updated: 1 });
      expect(await groupOf(entryA)).toBe('Arts');
    });

    it('same Idempotency-Key twice updates once and replays the answer', async () => {
      const { runId, entryA } = await seedRun();
      const key = `pg-${runId}`;
      const send = (group: string) =>
        call('patch', `/promotions/${runId}/groups`, UserRole.ADMIN, {
          'Idempotency-Key': key,
        }).send({
          entry_ids: [entryA],
          group_name: group,
        });

      const first = await send('Science').expect(200);
      // The replay skips the handler: the second, different body does not change the row.
      const second = await send('Arts').expect(200);

      expect(second.body).toEqual(first.body);
      expect(await groupOf(entryA)).toBe('Science');
    });

    it('a group outside the vocabulary is 422 with a fixed code and no echo', async () => {
      const { runId, entryA } = await seedRun();

      const res = await call('patch', `/promotions/${runId}/groups`, UserRole.ADMIN)
        .send({ entry_ids: [entryA], group_name: 'Zzz-Secret-Group' })
        .expect(422);

      expect(res.body.details?.code).toBe('GROUP_NOT_IN_VOCABULARY');
      expect(JSON.stringify(res.body)).not.toContain('Zzz-Secret-Group');
    });

    it('a school with no groups vocabulary is 422 GROUPS_NOT_CONFIGURED, GET still works', async () => {
      const { runId, entryA } = await seedRun();
      await setGroups([]);

      const res = await call('patch', `/promotions/${runId}/groups`, UserRole.ADMIN)
        .send({ entry_ids: [entryA], group_name: 'Science' })
        .expect(422);
      expect(res.body.details?.code).toBe('GROUPS_NOT_CONFIGURED');

      await call('get', `/promotions/${runId}/groups`, UserRole.ADMIN).expect(200);
    });

    it('a COMMITTED run is 409', async () => {
      const { runId, entryA } = await seedRun();
      await dataSource.query(`UPDATE promotion_runs SET status = 'COMMITTED' WHERE id = $1`, [
        runId,
      ]);

      await call('patch', `/promotions/${runId}/groups`, UserRole.ADMIN)
        .send({ entry_ids: [entryA], group_name: 'Science' })
        .expect(409);
    });

    it('TEACHER on a COMMITTED run: 404 outside their section, 409 inside, nothing written', async () => {
      const { runId, entryA, entryB, sectionA } = await seedRun();
      await makeTeacherOf(sectionA);
      await dataSource.query(`UPDATE promotion_runs SET status = 'COMMITTED' WHERE id = $1`, [
        runId,
      ]);
      const body = (id: string) => ({ entry_ids: [id], group_name: 'Science' });

      // Not their section: the same 404 as on a draft run, so the status is not leaked.
      await call('patch', `/promotions/${runId}/groups`, UserRole.TEACHER)
        .send(body(entryB))
        .expect(404);
      await call('patch', `/promotions/${runId}/groups`, UserRole.TEACHER)
        .send(body(entryA))
        .expect(409);

      expect(await groupOf(entryA)).toBeNull();
      expect(await groupOf(entryB)).toBeNull();
    });

    it('a run of a closed academic year is refused with ACADEMIC_YEAR_CLOSED', async () => {
      const { runId, entryA } = await seedRun({ closedYear: true });

      const res = await call('patch', `/promotions/${runId}/groups`, UserRole.ADMIN)
        .send({ entry_ids: [entryA], group_name: 'Science' })
        .expect(409);

      expect(res.body.details?.code).toBe('ACADEMIC_YEAR_CLOSED');
      expect(await groupOf(entryA)).toBeNull();
    });

    it('PARENT gets 403; non-UUID id and entry id are 400; empty body is 400', async () => {
      const { runId, entryA } = await seedRun();
      await call('patch', `/promotions/${runId}/groups`, UserRole.PARENT)
        .send({ entry_ids: [entryA], group_name: 'Science' })
        .expect(403);
      await call('patch', `/promotions/not-a-uuid/groups`, UserRole.ADMIN)
        .send({ entry_ids: [entryA], group_name: 'Science' })
        .expect(400);
      await call('patch', `/promotions/${runId}/groups`, UserRole.ADMIN)
        .send({ entry_ids: ['nope'], group_name: 'Science' })
        .expect(400);
      await call('patch', `/promotions/${runId}/groups`, UserRole.ADMIN).send({}).expect(400);
    });

    it('rejects a missing and an invalid X-Tenant-ID', async () => {
      const { runId, entryA } = await seedRun();
      const body = { entry_ids: [entryA], group_name: 'Science' };
      const noTenant = await supertest(app.getHttpServer())
        .patch(`${API}/promotions/${runId}/groups`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Role', UserRole.ADMIN)
        .send(body);
      expect([400, 401, 403]).toContain(noTenant.status);

      const badTenant = await call('patch', `/promotions/${runId}/groups`, UserRole.ADMIN, {
        'X-Tenant-ID': 'not-a-uuid',
      }).send(body);
      expect([400, 401, 403]).toContain(badTenant.status);
      expect(await groupOf(entryA)).toBeNull();
    });
  });
});
