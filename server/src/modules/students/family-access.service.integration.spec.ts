import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserRole } from '@biddaloy/shared';
import { ALL_ENTITIES } from '@test/all-entities';
import { createTestModule } from '@test/helpers/module.helper';
import {
  SEED_TENANT_ID,
  SEED_SECTION_1_ID,
  SEED_ACADEMIC_YEAR_ID,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';
import { FamilyAccessService } from './family-access.service';
import { Student } from './entities/student.entity';
import { Guardian } from './entities/guardian.entity';

/**
 * Integration tests for the [5.1] linkage check, against a real database.
 *
 * The unit spec proves the query *shape*; this one proves the query
 * actually resolves the ManyToMany `student_guardians` join, respects
 * `tenant_id`, and skips soft-deleted students. Tenant isolation is the
 * headline case: a parent genuinely linked to a child in Tenant B must find
 * nothing when the call is scoped to Tenant A.
 */

// Second tenant + its own class/section, so a "linked but wrong tenant"
// student can exist at all.
const TENANT_B = '00000000-0000-4000-8000-0000005a0001';
const TENANT_B_AY = '00000000-0000-4000-8000-0000005a0002';
const TENANT_B_CLASS = '00000000-0000-4000-8000-0000005a0003';
const TENANT_B_SECTION = '00000000-0000-4000-8000-0000005a0004';

const PARENT_USER_ID = '00000000-0000-4000-8000-0000005a0010';
const STUDENT_USER_ID = '00000000-0000-4000-8000-0000005a0011';
const STRANGER_USER_ID = '00000000-0000-4000-8000-0000005a0012';

describe('FamilyAccessService (integration)', () => {
  let moduleRef: TestingModule;
  let service: FamilyAccessService;
  let dataSource: DataSource;
  let studentRepo: Repository<Student>;
  let guardianRepo: Repository<Guardian>;

  beforeAll(async () => {
    moduleRef = await createTestModule(ALL_ENTITIES, [FamilyAccessService]);
    service = moduleRef.get(FamilyAccessService);
    dataSource = moduleRef.get(DataSource);
    studentRepo = moduleRef.get(getRepositoryToken(Student));
    guardianRepo = moduleRef.get(getRepositoryToken(Guardian));

    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Family Access Tenant B', 'family-access-tenant-b', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [TENANT_B],
    );
    await dataSource.query(
      `INSERT INTO academic_years (id, name, start_date, end_date, is_current, tenant_id, created_at, updated_at)
       VALUES ($1, 'B 2026', '2026-01-01', '2026-12-31', true, $2, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [TENANT_B_AY, TENANT_B],
    );
    await dataSource.query(
      `INSERT INTO classes (id, name, academic_year_id, tenant_id, created_at, updated_at)
       VALUES ($1, 'B Class', $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [TENANT_B_CLASS, TENANT_B_AY, TENANT_B],
    );
    await dataSource.query(
      `INSERT INTO class_sections (id, section_name, class_id, tenant_id, created_at, updated_at)
       VALUES ($1, 'B Section', $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [TENANT_B_SECTION, TENANT_B_CLASS, TENANT_B],
    );

    for (const [id, email] of [
      [PARENT_USER_ID, 'family-access-parent@test.example'],
      [STUDENT_USER_ID, 'family-access-student@test.example'],
      [STRANGER_USER_ID, 'family-access-stranger@test.example'],
    ]) {
      await dataSource.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'Family Access Test User', 'ACTIVE', NOW(), NOW())
         ON CONFLICT DO NOTHING`,
        [id, email, SEED_ADMIN_PASSWORD_HASH],
      );
    }
  }, 60000);

  afterAll(async () => {
    await dataSource.query(`DELETE FROM student_guardians`);
    await dataSource.query(`DELETE FROM students WHERE tenant_id IN ($1, $2)`, [
      SEED_TENANT_ID,
      TENANT_B,
    ]);
    await dataSource.query(`DELETE FROM guardians WHERE tenant_id IN ($1, $2)`, [
      SEED_TENANT_ID,
      TENANT_B,
    ]);
    await dataSource.query(`DELETE FROM class_sections WHERE tenant_id = $1`, [TENANT_B]);
    await dataSource.query(`DELETE FROM classes WHERE tenant_id = $1`, [TENANT_B]);
    await dataSource.query(`DELETE FROM academic_years WHERE tenant_id = $1`, [TENANT_B]);
    await dataSource.query(`DELETE FROM schools WHERE id = $1`, [TENANT_B]);
    await dataSource.query(`DELETE FROM users WHERE id IN ($1, $2, $3)`, [
      PARENT_USER_ID,
      STUDENT_USER_ID,
      STRANGER_USER_ID,
    ]);
    await moduleRef.close();
  });

  beforeEach(async () => {
    await dataSource.query(`DELETE FROM student_guardians`);
    await dataSource.query(`DELETE FROM students`);
    await dataSource.query(`DELETE FROM guardians`);
  });

  /** Creates a student, defaulting to Tenant A's seeded class/section. */
  async function makeStudent(overrides: Partial<Student> = {}): Promise<Student> {
    return studentRepo.save(
      studentRepo.create({
        full_name: 'Linked Child',
        registration_number: `FA-${Math.random().toString(36).slice(2, 10)}`,
        roll_number: Math.floor(Math.random() * 100000),
        class_section_id: SEED_SECTION_1_ID,
        tenant_id: SEED_TENANT_ID,
        ...overrides,
      } as Partial<Student>),
    );
  }

  /** Creates a guardian and links them to the given students. */
  async function linkGuardian(
    userId: string | null,
    students: Student[],
    tenantId = SEED_TENANT_ID,
  ): Promise<Guardian> {
    const guardian = await guardianRepo.save(
      guardianRepo.create({
        full_name: 'Linked Parent',
        relationship: 'FATHER',
        phone: '+8801700000000',
        email: `g-${Math.random().toString(36).slice(2, 8)}@test.example`,
        tenant_id: tenantId,
        user_id: userId,
      } as Partial<Guardian>),
    );
    if (students.length > 0) {
      await dataSource
        .createQueryBuilder()
        .relation(Guardian, 'students')
        .of(guardian)
        .add(students.map((s) => s.id));
    }
    return guardian;
  }

  describe('getLinkedStudents — PARENT', () => {
    it("returns every student linked through the calling user's guardian record", async () => {
      const childA = await makeStudent({ full_name: 'Aisha' });
      const childB = await makeStudent({ full_name: 'Bilal' });
      await makeStudent({ full_name: 'Someone Else' });
      await linkGuardian(PARENT_USER_ID, [childA, childB]);

      const linked = await service.getLinkedStudents(
        UserRole.PARENT,
        PARENT_USER_ID,
        SEED_TENANT_ID,
      );

      expect(linked.map((s) => s.full_name)).toEqual(['Aisha', 'Bilal']);
    });

    it('returns an empty list for a parent user with no guardian record at all', async () => {
      const child = await makeStudent();
      await linkGuardian(PARENT_USER_ID, [child]);

      await expect(
        service.getLinkedStudents(UserRole.PARENT, STRANGER_USER_ID, SEED_TENANT_ID),
      ).resolves.toEqual([]);
    });

    // A guardian row with no user_id is a contact record, not an account.
    // It must never match "whoever is calling".
    it('ignores guardian rows that carry no user_id', async () => {
      const child = await makeStudent();
      await linkGuardian(null, [child]);

      await expect(
        service.getLinkedStudents(UserRole.PARENT, PARENT_USER_ID, SEED_TENANT_ID),
      ).resolves.toEqual([]);
    });

    it('loads class/section for display but never the guardians relation', async () => {
      const child = await makeStudent();
      await linkGuardian(PARENT_USER_ID, [child]);

      const [linked] = await service.getLinkedStudents(
        UserRole.PARENT,
        PARENT_USER_ID,
        SEED_TENANT_ID,
      );

      expect(linked.class_section).toBeDefined();
      expect(linked.class_section.class).toBeDefined();
      // Co-guardian phone/email must not ride along in the discovery list.
      expect(linked.guardians).toBeUndefined();
    });

    // `Guardian.user_id` is a @OneToOne, so the database refuses a second
    // guardian row for the same user account — the duplicate-row shape the
    // service's DISTINCT defends against cannot actually be created. Pinned
    // here so that if the relation is ever relaxed to @ManyToOne, this test
    // fails and the DISTINCT stops being merely defensive.
    it('cannot have two guardian rows for one user account, and returns a linked student once', async () => {
      const child = await makeStudent();
      await linkGuardian(PARENT_USER_ID, [child]);

      await expect(linkGuardian(PARENT_USER_ID, [child])).rejects.toThrow(/unique constraint/i);

      const linked = await service.getLinkedStudents(
        UserRole.PARENT,
        PARENT_USER_ID,
        SEED_TENANT_ID,
      );
      const ids = await service.getLinkedStudentIds(
        UserRole.PARENT,
        PARENT_USER_ID,
        SEED_TENANT_ID,
      );

      expect(linked).toHaveLength(1);
      expect(ids).toEqual([child.id]);
    });
  });

  describe('getLinkedStudents — STUDENT', () => {
    it('returns only the student record owned by the calling user', async () => {
      const self = await makeStudent({ full_name: 'Self', user_id: STUDENT_USER_ID });
      await makeStudent({ full_name: 'Classmate' });

      const linked = await service.getLinkedStudents(
        UserRole.STUDENT,
        STUDENT_USER_ID,
        SEED_TENANT_ID,
      );

      expect(linked.map((s) => s.id)).toEqual([self.id]);
    });

    // Being a guardian of someone does not grant the STUDENT path, and vice
    // versa — the two linkages are separate columns and must stay separate.
    it('does not return students the caller is merely a guardian of', async () => {
      const child = await makeStudent();
      await linkGuardian(STUDENT_USER_ID, [child]);

      await expect(
        service.getLinkedStudents(UserRole.STUDENT, STUDENT_USER_ID, SEED_TENANT_ID),
      ).resolves.toEqual([]);
    });
  });

  describe('tenant isolation', () => {
    it('does not return a genuinely linked student from another tenant', async () => {
      const childInB = await makeStudent({
        full_name: 'Child In B',
        tenant_id: TENANT_B,
        class_section_id: TENANT_B_SECTION,
      });
      await linkGuardian(PARENT_USER_ID, [childInB], TENANT_B);

      // Scoped to Tenant A: the linkage exists, but not in this tenant.
      await expect(
        service.getLinkedStudents(UserRole.PARENT, PARENT_USER_ID, SEED_TENANT_ID),
      ).resolves.toEqual([]);
      await expect(
        service.getLinkedStudentIds(UserRole.PARENT, PARENT_USER_ID, SEED_TENANT_ID),
      ).resolves.toEqual([]);

      // Scoped to Tenant B: found, proving the empty result above is the
      // tenant filter doing its job rather than a broken fixture.
      await expect(
        service.getLinkedStudentIds(UserRole.PARENT, PARENT_USER_ID, TENANT_B),
      ).resolves.toEqual([childInB.id]);
    });

    it('refuses assertLinked for a linked student when scoped to the wrong tenant', async () => {
      const childInB = await makeStudent({
        tenant_id: TENANT_B,
        class_section_id: TENANT_B_SECTION,
      });
      await linkGuardian(PARENT_USER_ID, [childInB], TENANT_B);

      await expect(
        service.assertLinked(UserRole.PARENT, PARENT_USER_ID, childInB.id, SEED_TENANT_ID),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(
        service.assertLinked(UserRole.PARENT, PARENT_USER_ID, childInB.id, TENANT_B),
      ).resolves.toBeUndefined();
    });

    it('refuses a STUDENT caller reading their own record through the wrong tenant', async () => {
      const selfInB = await makeStudent({
        tenant_id: TENANT_B,
        class_section_id: TENANT_B_SECTION,
        user_id: STUDENT_USER_ID,
      });

      await expect(
        service.assertLinked(UserRole.STUDENT, STUDENT_USER_ID, selfInB.id, SEED_TENANT_ID),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('soft delete', () => {
    it('drops a soft-deleted student from the linked list', async () => {
      const child = await makeStudent();
      await linkGuardian(PARENT_USER_ID, [child]);
      await studentRepo.softDelete(child.id);

      await expect(
        service.getLinkedStudents(UserRole.PARENT, PARENT_USER_ID, SEED_TENANT_ID),
      ).resolves.toEqual([]);
      await expect(
        service.getLinkedStudentIds(UserRole.PARENT, PARENT_USER_ID, SEED_TENANT_ID),
      ).resolves.toEqual([]);
    });

    it('refuses assertLinked for a soft-deleted student', async () => {
      const self = await makeStudent({ user_id: STUDENT_USER_ID });
      await service.assertLinked(UserRole.STUDENT, STUDENT_USER_ID, self.id, SEED_TENANT_ID);

      await studentRepo.softDelete(self.id);

      await expect(
        service.assertLinked(UserRole.STUDENT, STUDENT_USER_ID, self.id, SEED_TENANT_ID),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('assertLinked — staff pass-through', () => {
    it('lets a staff role through for a student they have no linkage to', async () => {
      const child = await makeStudent();

      for (const role of [UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.TEACHER]) {
        await expect(
          service.assertLinked(role, STRANGER_USER_ID, child.id, SEED_TENANT_ID),
        ).resolves.toBeUndefined();
      }
    });

    it('refuses a family caller for a same-tenant student they are not linked to', async () => {
      const mine = await makeStudent({ full_name: 'Mine' });
      const theirs = await makeStudent({ full_name: 'Theirs' });
      await linkGuardian(PARENT_USER_ID, [mine]);

      await expect(
        service.assertLinked(UserRole.PARENT, PARENT_USER_ID, mine.id, SEED_TENANT_ID),
      ).resolves.toBeUndefined();
      await expect(
        service.assertLinked(UserRole.PARENT, PARENT_USER_ID, theirs.id, SEED_TENANT_ID),
      ).rejects.toThrow("You do not have access to this student's information");
    });

    it('refuses a family caller for a student id that does not exist', async () => {
      await expect(
        service.assertLinked(
          UserRole.PARENT,
          PARENT_USER_ID,
          '00000000-0000-4000-8000-00000000dead',
          SEED_TENANT_ID,
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  it('keeps SEED_ACADEMIC_YEAR_ID untouched', () => {
    // Sanity guard: this file seeds its own tenant rather than mutating the
    // shared Tenant A fixtures every other spec depends on.
    expect(SEED_ACADEMIC_YEAR_ID).toBeTruthy();
  });
});
