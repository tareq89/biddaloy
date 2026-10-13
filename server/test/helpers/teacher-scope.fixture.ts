import { randomUUID } from 'node:crypto';
import supertest = require('supertest');
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TeacherAssignmentType, TeacherDesignation, UserRole } from '@biddaloy/shared';
import { Teacher } from '../../src/modules/academics/entities/teacher.entity';
import {
  SEED_ACADEMIC_YEAR_ID,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
  SEED_TENANT_ID,
} from '../constants';

/**
 * Epic 75 (75.6) fixture for teacher-scope e2e specs.
 *
 * One TEACHER with a SUBJECT_TEACHER row in section A and a CLASS_TEACHER row in section C
 * (a past academic year); nothing in section B. Each section holds one student and one guardian.
 *
 * `students`, `guardians`, `teachers` and `teacher_class_sections` are truncated before every
 * `it()`, so: call `createTeacherScopeFixture()` once in `beforeAll` (user, membership, sections,
 * token) and `fixture.seed()` in `beforeEach` (the rows above). `cleanup()` goes in `afterAll`.
 */
export interface TeacherScopeFixture {
  teacherUserId: string;
  tenantId: string;
  sectionA: string;
  sectionB: string;
  sectionC: string;
  studentA: string;
  studentB: string;
  studentC: string;
  guardianA: string;
  guardianB: string;
  guardianC: string;
  /** Bearer token of the fixture teacher (logs in once). */
  login(): Promise<string>;
  /** Re-creates the per-test rows (teacher, assignments, students, guardians). */
  seed(): Promise<void>;
  cleanup(): Promise<void>;
}

export async function createTeacherScopeFixture(
  app: INestApplication,
  dataSource: DataSource,
): Promise<TeacherScopeFixture> {
  const tenantId = SEED_TENANT_ID;
  const tag = randomUUID().slice(0, 8);
  const email = `teacher-scope-${tag}@e2e.example`;

  const [user] = await dataSource.query(
    `INSERT INTO users (email, password_hash, full_name, status, created_at, updated_at)
     VALUES ($1, $2, 'Teacher Scope Teacher', 'ACTIVE', NOW(), NOW()) RETURNING id`,
    [email, SEED_ADMIN_PASSWORD_HASH],
  );
  await dataSource.query(
    `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
     VALUES ($1, $2, $3, NOW(), NOW())`,
    [user.id, tenantId, UserRole.TEACHER],
  );

  // The seed year is the tenant's current one; C lives in a past year.
  await dataSource.query(`UPDATE academic_years SET is_current = (id = $2) WHERE tenant_id = $1`, [
    tenantId,
    SEED_ACADEMIC_YEAR_ID,
  ]);
  const [pastYear] = await dataSource.query(
    `INSERT INTO academic_years (name, start_date, end_date, is_current, tenant_id, created_at, updated_at)
     VALUES ($1, '2018-01-01', '2018-12-31', false, $2, NOW(), NOW()) RETURNING id`,
    [`TS Past ${tag}`, tenantId],
  );
  const classIds: string[] = [];
  const makeSection = async (yearId: string, name: string) => {
    const [klass] = await dataSource.query(
      `INSERT INTO classes (tenant_id, name, academic_year_id) VALUES ($1, $2, $3) RETURNING id`,
      [tenantId, `TS ${name} ${tag}`, yearId],
    );
    const [section] = await dataSource.query(
      `INSERT INTO class_sections (tenant_id, class_id, section_name) VALUES ($1, $2, $3) RETURNING id`,
      [tenantId, klass.id, name],
    );
    classIds.push(klass.id);
    return section.id as string;
  };
  const sectionA = await makeSection(SEED_ACADEMIC_YEAR_ID, 'A');
  const sectionB = await makeSection(SEED_ACADEMIC_YEAR_ID, 'B');
  const sectionC = await makeSection(pastYear.id, 'C');

  const fixture: TeacherScopeFixture = {
    teacherUserId: user.id,
    tenantId,
    sectionA,
    sectionB,
    sectionC,
    studentA: '',
    studentB: '',
    studentC: '',
    guardianA: '',
    guardianB: '',
    guardianC: '',

    async login() {
      const res = await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: SEED_ADMIN_PASSWORD })
        .expect(200);
      return res.body.access_token as string;
    },

    async seed() {
      // Via the repository so the `staff_profile_id` default runs.
      const teacher = await dataSource.getRepository(Teacher).save({
        user_id: user.id,
        employee_id: `EMP-TS-${tag}`,
        tenant_id: tenantId,
        designations: [TeacherDesignation.SUBJECT_TEACHER],
      });
      // `subjects` is truncated per test too.
      const [subject] = await dataSource.query(
        `INSERT INTO subjects (tenant_id, name_en, code) VALUES ($1, $2, $3) RETURNING id`,
        [tenantId, `TS Subject ${tag}`, `TS${tag}`],
      );
      await dataSource.query(
        `INSERT INTO teacher_class_sections (teacher_id, section_id, tenant_id, subject_id, assignment_type)
         VALUES ($1, $2, $3, $4, $5), ($1, $6, $3, NULL, $7)`,
        [
          teacher.id,
          sectionA,
          tenantId,
          subject.id,
          TeacherAssignmentType.SUBJECT_TEACHER,
          sectionC,
          TeacherAssignmentType.CLASS_TEACHER,
        ],
      );
      const make = async (section: string, label: string, roll: number) => {
        const [student] = await dataSource.query(
          `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, preferred_communication, enrollment_status, tenant_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, 'SMS', 'ACTIVE', $5, NOW(), NOW()) RETURNING id`,
          [`TS Student ${label}`, `TS-${tag}-${label}`, roll, section, tenantId],
        );
        const [guardian] = await dataSource.query(
          `INSERT INTO guardians (full_name, relationship, phone, tenant_id)
           VALUES ($1, 'FATHER', $2, $3) RETURNING id`,
          [`TS Guardian ${label}`, `+88017000${roll}`, tenantId],
        );
        await dataSource.query(
          `INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)`,
          [student.id, guardian.id],
        );
        return { student: student.id as string, guardian: guardian.id as string };
      };
      const a = await make(sectionA, 'A', 90001);
      const b = await make(sectionB, 'B', 90002);
      const c = await make(sectionC, 'C', 90003);
      Object.assign(fixture, {
        studentA: a.student,
        studentB: b.student,
        studentC: c.student,
        guardianA: a.guardian,
        guardianB: b.guardian,
        guardianC: c.guardian,
      });
    },

    async cleanup() {
      await dataSource.query(`DELETE FROM student_guardians`);
      await dataSource.query(`DELETE FROM students WHERE tenant_id = $1 AND roll_number >= 90001`, [
        tenantId,
      ]);
      await dataSource.query(`DELETE FROM class_sections WHERE class_id = ANY($1)`, [classIds]);
      await dataSource.query(`DELETE FROM classes WHERE id = ANY($1)`, [classIds]);
      await dataSource.query(`DELETE FROM academic_years WHERE id = $1`, [pastYear.id]);
      await dataSource.query(`DELETE FROM user_tenants WHERE user_id = $1`, [user.id]);
      await dataSource.query(`DELETE FROM users WHERE id = $1`, [user.id]);
    },
  };
  return fixture;
}

/**
 * Makes `userId` a CLASS_TEACHER of `sectionId` (a section of the current academic year), so a
 * spec that exercises a TEACHER on a student route can reach that section's students.
 * `teachers` and `teacher_class_sections` are truncated before every `it()`: call per test.
 */
export async function assignTeacherToSection(
  dataSource: DataSource,
  userId: string,
  sectionId: string,
  tenantId = SEED_TENANT_ID,
): Promise<void> {
  const repo = dataSource.getRepository(Teacher);
  const teacher =
    (await repo.findOneBy({ user_id: userId, tenant_id: tenantId })) ??
    (await repo.save({
      user_id: userId,
      employee_id: `EMP-AS-${randomUUID().slice(0, 8)}`,
      tenant_id: tenantId,
      designations: [],
    }));
  await dataSource.query(
    `INSERT INTO teacher_class_sections (teacher_id, section_id, tenant_id, assignment_type)
     VALUES ($1, $2, $3, 'CLASS_TEACHER')`,
    [teacher.id, sectionId, tenantId],
  );
}
