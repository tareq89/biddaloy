import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource, Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { TestingModule } from '@nestjs/testing';
import { TeacherDesignation } from '@biddaloy/shared';
import { School } from '../../../schools/entities/school.entity';
import { User } from '../../../users/entities/user.entity';
import { Teacher } from '../../../academics/entities/teacher.entity';
import { AcademicYear } from '../../../academics/entities/academic-year.entity';
import { Class } from '../../../academics/entities/class.entity';
import { ClassSection } from '../../../academics/entities/class-section.entity';
import { Subject } from '../../../academics/entities/subject.entity';
import { TeacherClassSection } from '../../../academics/entities/teacher-class-section.entity';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { teacherAssignmentsTab, type TeacherAssignmentRow } from './teacher-assignments.tab';

/**
 * Integration tests for the `teacher_assignments` tab against a real
 * Postgres database.
 *
 * Needs a full fixture chain — school, user, teacher, academic year, class,
 * section, subject — built once per tenant by `seedChain` below, since
 * `TeacherClassSection` only makes sense pointing at all of them.
 */
describe('teacherAssignmentsTab (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let schoolRepo: Repository<School>;
  let userRepo: Repository<User>;
  let teacherRepo: Repository<Teacher>;
  let yearRepo: Repository<AcademicYear>;
  let classRepo: Repository<Class>;
  let sectionRepo: Repository<ClassSection>;
  let subjectRepo: Repository<Subject>;
  let assignmentRepo: Repository<TeacherClassSection>;

  const TENANT_A = '11111111-1111-4111-8111-111111111111';
  const TENANT_B = '22222222-2222-4222-8222-222222222222';

  beforeAll(async () => {
    module = await createTestModule(ALL_ENTITIES, []);
    dataSource = module.get(DataSource);
    schoolRepo = module.get<Repository<School>>(getRepositoryToken(School));
    userRepo = module.get<Repository<User>>(getRepositoryToken(User));
    teacherRepo = module.get<Repository<Teacher>>(getRepositoryToken(Teacher));
    yearRepo = module.get<Repository<AcademicYear>>(getRepositoryToken(AcademicYear));
    classRepo = module.get<Repository<Class>>(getRepositoryToken(Class));
    sectionRepo = module.get<Repository<ClassSection>>(getRepositoryToken(ClassSection));
    subjectRepo = module.get<Repository<Subject>>(getRepositoryToken(Subject));
    assignmentRepo = module.get<Repository<TeacherClassSection>>(
      getRepositoryToken(TeacherClassSection),
    );
  });

  afterAll(async () => {
    await module?.close();
  });

  beforeEach(async () => {
    // Children before parents, both tenants.
    await assignmentRepo
      .createQueryBuilder()
      .delete()
      .where('tenant_id IN (:...ids)', { ids: [TENANT_A, TENANT_B] })
      .execute();
    await subjectRepo.delete({ tenant_id: TENANT_A });
    await subjectRepo.delete({ tenant_id: TENANT_B });
    await sectionRepo.delete({ tenant_id: TENANT_A });
    await sectionRepo.delete({ tenant_id: TENANT_B });
    await classRepo.delete({ tenant_id: TENANT_A });
    await classRepo.delete({ tenant_id: TENANT_B });
    await yearRepo.delete({ tenant_id: TENANT_A });
    await yearRepo.delete({ tenant_id: TENANT_B });
    await teacherRepo
      .createQueryBuilder()
      .delete()
      .where('tenant_id IN (:...ids)', { ids: [TENANT_A, TENANT_B] })
      .execute();
    await userRepo
      .createQueryBuilder()
      .delete()
      .where('email LIKE :d', { d: '%@assignments.test' })
      .execute();
    await schoolRepo.delete({ id: TENANT_A });
    await schoolRepo.delete({ id: TENANT_B });

    await schoolRepo.save(
      schoolRepo.create({ id: TENANT_A, name: 'Tenant A School', slug: 'tenant-a-assignments' }),
    );
    await schoolRepo.save(
      schoolRepo.create({ id: TENANT_B, name: 'Tenant B School', slug: 'tenant-b-assignments' }),
    );
  });

  interface Chain {
    teacher: Teacher;
    year: AcademicYear;
    klass: Class;
    section: ClassSection;
    subject: Subject;
  }

  // `Teacher.employee_id` and `User` email are globally unique, so each
  // tenant's fixture chain must use its own distinct values or the
  // tenant-isolation test would fail on an insert rather than the
  // assertion it means to make.
  async function seedChain(tenantId: string, tag: string): Promise<Chain> {
    const user = await userRepo.save(
      userRepo.create({
        email: `teacher-${tag}@assignments.test`,
        phone: null,
        full_name: `Teacher ${tag}`,
        password_hash: null,
      }),
    );
    const teacher = await teacherRepo.save(
      teacherRepo.create({
        user_id: user.id,
        employee_id: `EMP-${tag}`,
        designations: [TeacherDesignation.SUBJECT_TEACHER],
        subject_specialization: null,
        joining_date: null,
        tenant_id: tenantId,
      }),
    );
    const year = await yearRepo.save(
      yearRepo.create({
        name: `2026-${tag}`,
        start_date: new Date('2026-01-01'),
        end_date: new Date('2026-12-31'),
        is_current: true,
        tenant_id: tenantId,
      }),
    );
    const klass = await classRepo.save(
      classRepo.create({
        name: `Six-${tag}`,
        numeric_grade: 6,
        academic_year_id: year.id,
        tenant_id: tenantId,
      }),
    );
    const section = await sectionRepo.save(
      sectionRepo.create({
        class_id: klass.id,
        section_name: 'A',
        capacity: null,
        tenant_id: tenantId,
      }),
    );
    const subject = await subjectRepo.save(
      subjectRepo.create({
        code: `MATH-${tag}`,
        name_en: 'Mathematics',
        name_bn: null,
        is_active: true,
        tenant_id: tenantId,
      }),
    );

    return { teacher, year, klass, section, subject };
  }

  function rowFor(
    chain: Chain,
    overrides: Partial<TeacherAssignmentRow> = {},
  ): TeacherAssignmentRow {
    return {
      id: '00000000-0000-4000-8000-000000000000',
      teacher_id: chain.teacher.id,
      section_id: chain.section.id,
      subject_id: chain.subject.id,
      teacher_key: chain.teacher.employee_id,
      class_key: `${chain.klass.name}|${chain.year.name}`,
      academic_year_key: chain.year.name,
      section_key: `${chain.klass.name}|${chain.year.name}|${chain.year.name}|A`,
      subject_key: chain.subject.code,
      ...overrides,
    };
  }

  describe('upsert', () => {
    it('creates an assignment with a subject', async () => {
      const chain = await seedChain(TENANT_A, 'cws');
      const row = rowFor(chain);

      const created = await teacherAssignmentsTab.upsert(row, null, TENANT_A, dataSource.manager);

      const saved = await assignmentRepo.findOneByOrFail({ id: created.id });
      expect(saved.teacher_id).toBe(chain.teacher.id);
      expect(saved.section_id).toBe(chain.section.id);
      expect(saved.subject_id).toBe(chain.subject.id);
      expect(saved.tenant_id).toBe(TENANT_A);
    });

    it('creates an assignment without a subject (class-teacher case)', async () => {
      const chain = await seedChain(TENANT_A, 'cns');
      const row = rowFor(chain, { subject_id: null, subject_key: '' });

      const created = await teacherAssignmentsTab.upsert(row, null, TENANT_A, dataSource.manager);

      const saved = await assignmentRepo.findOneByOrFail({ id: created.id });
      expect(saved.subject_id).toBeNull();
    });

    it('updates subject_id for an existing assignment', async () => {
      const chain = await seedChain(TENANT_A, 'us');
      const existing = await teacherAssignmentsTab.upsert(
        rowFor(chain, { subject_id: null, subject_key: '' }),
        null,
        TENANT_A,
        dataSource.manager,
      );

      const updated = await teacherAssignmentsTab.upsert(
        rowFor(chain, { id: existing.id }),
        existing,
        TENANT_A,
        dataSource.manager,
      );

      const saved = await assignmentRepo.findOneByOrFail({ id: updated.id });
      expect(saved.subject_id).toBe(chain.subject.id);
    });

    it('upsert twice with a null-subject row stays one row (IsNull / partial-index case)', async () => {
      const chain = await seedChain(TENANT_A, 'nst');
      const row = rowFor(chain, { subject_id: null, subject_key: '' });

      const first = await teacherAssignmentsTab.upsert(row, null, TENANT_A, dataSource.manager);
      await teacherAssignmentsTab.upsert(row, first, TENANT_A, dataSource.manager);

      const all = await assignmentRepo.find({
        where: { teacher_id: chain.teacher.id, section_id: chain.section.id },
      });
      expect(all).toHaveLength(1);
    });
  });

  describe('rm', () => {
    it('hard-deletes: the row is gone from the table entirely', async () => {
      const chain = await seedChain(TENANT_A, 'rm');
      const created = await teacherAssignmentsTab.upsert(
        rowFor(chain),
        null,
        TENANT_A,
        dataSource.manager,
      );

      await teacherAssignmentsTab.remove(created, dataSource.manager);

      const gone = await assignmentRepo.findOne({ where: { id: created.id } });
      expect(gone).toBeNull();
    });
  });

  describe('load', () => {
    it('never returns a tenant B assignment when loading tenant A', async () => {
      const chainA = await seedChain(TENANT_A, 'la');
      const createdA = await teacherAssignmentsTab.upsert(
        rowFor(chainA),
        null,
        TENANT_A,
        dataSource.manager,
      );
      const chainB = await seedChain(TENANT_B, 'lb');
      await teacherAssignmentsTab.upsert(rowFor(chainB), null, TENANT_B, dataSource.manager);

      const loaded = await teacherAssignmentsTab.load(TENANT_A, dataSource.manager);

      expect(loaded.map((a) => a.id)).toEqual([createdA.id]);
    });

    it('attaches the relations keyOf needs: no empty fragment, no uuid', async () => {
      const chain = await seedChain(TENANT_A, 'lr');
      await teacherAssignmentsTab.upsert(rowFor(chain), null, TENANT_A, dataSource.manager);

      const [loaded] = await teacherAssignmentsTab.load(TENANT_A, dataSource.manager);

      const key = teacherAssignmentsTab.keyOf(loaded);
      const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
      expect(key).not.toMatch(UUID_RE);
      expect(key.split('|').some((fragment) => fragment === '')).toBe(false);
    });
  });
});
