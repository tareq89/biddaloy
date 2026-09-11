import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource, Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { TestingModule } from '@nestjs/testing';
import { EnrollmentStatus } from '@biddaloy/shared';
import { School } from '../../../schools/entities/school.entity';
import { AcademicYear } from '../../../academics/entities/academic-year.entity';
import { Class } from '../../../academics/entities/class.entity';
import { ClassSection } from '../../../academics/entities/class-section.entity';
import { Student } from '../../../students/entities/student.entity';
import { Enrollment } from '../../../students/entities/enrollment.entity';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { enrollmentsTab, type EnrollmentRow } from './enrollments.tab';

/**
 * Integration tests for the `enrollments` tab against a real Postgres
 * database.
 *
 * Fixture chain: school -> academic year -> class -> section -> student ->
 * enrollment, seeded per tenant by `seedChain` below.
 */
describe('enrollmentsTab (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let schoolRepo: Repository<School>;
  let yearRepo: Repository<AcademicYear>;
  let classRepo: Repository<Class>;
  let sectionRepo: Repository<ClassSection>;
  let studentRepo: Repository<Student>;
  let enrollmentRepo: Repository<Enrollment>;

  const TENANT_A = '11111111-1111-4111-8111-111111111111';
  const TENANT_B = '22222222-2222-4222-8222-222222222222';

  beforeAll(async () => {
    module = await createTestModule(ALL_ENTITIES, []);
    dataSource = module.get(DataSource);
    schoolRepo = module.get<Repository<School>>(getRepositoryToken(School));
    yearRepo = module.get<Repository<AcademicYear>>(getRepositoryToken(AcademicYear));
    classRepo = module.get<Repository<Class>>(getRepositoryToken(Class));
    sectionRepo = module.get<Repository<ClassSection>>(getRepositoryToken(ClassSection));
    studentRepo = module.get<Repository<Student>>(getRepositoryToken(Student));
    enrollmentRepo = module.get<Repository<Enrollment>>(getRepositoryToken(Enrollment));
  });

  afterAll(async () => {
    await module?.close();
  });

  beforeEach(async () => {
    // Children before parents, both tenants.
    await enrollmentRepo
      .createQueryBuilder()
      .delete()
      .where('tenant_id IN (:...ids)', { ids: [TENANT_A, TENANT_B] })
      .execute();
    await studentRepo
      .createQueryBuilder()
      .delete()
      .where('tenant_id IN (:...ids)', { ids: [TENANT_A, TENANT_B] })
      .execute();
    await sectionRepo.delete({ tenant_id: TENANT_A });
    await sectionRepo.delete({ tenant_id: TENANT_B });
    await classRepo.delete({ tenant_id: TENANT_A });
    await classRepo.delete({ tenant_id: TENANT_B });
    await yearRepo.delete({ tenant_id: TENANT_A });
    await yearRepo.delete({ tenant_id: TENANT_B });
    await schoolRepo.delete({ id: TENANT_A });
    await schoolRepo.delete({ id: TENANT_B });

    await schoolRepo.save(
      schoolRepo.create({ id: TENANT_A, name: 'Tenant A School', slug: 'tenant-a-enrollments' }),
    );
    await schoolRepo.save(
      schoolRepo.create({ id: TENANT_B, name: 'Tenant B School', slug: 'tenant-b-enrollments' }),
    );
  });

  interface Chain {
    year: AcademicYear;
    klass: Class;
    section: ClassSection;
    student: Student;
  }

  // `Student.registration_number` is unique per tenant, so each seeded
  // student needs its own tag.
  async function seedChain(
    tenantId: string,
    tag: string,
    yearName = `2026-${tag}`,
  ): Promise<Chain> {
    const year = await yearRepo.save(
      yearRepo.create({
        name: yearName,
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
    const student = await studentRepo.save(
      studentRepo.create({
        full_name: `Student ${tag}`,
        registration_number: `REG-${tag}`,
        roll_number: 1,
        class_section_id: section.id,
        tenant_id: tenantId,
      }),
    );

    return { year, klass, section, student };
  }

  function rowFor(chain: Chain, overrides: Partial<EnrollmentRow> = {}): EnrollmentRow {
    return {
      id: '00000000-0000-4000-8000-000000000000',
      student_id: chain.student.id,
      class_id: chain.klass.id,
      academic_year_id: chain.year.id,
      section_id: chain.section.id,
      enrollment_status: EnrollmentStatus.ACTIVE,
      enrolled_at: new Date('2026-01-15T00:00:00.000Z').toISOString(),
      student_key: chain.student.registration_number,
      class_key: `${chain.klass.name}|${chain.year.name}`,
      academic_year_key: chain.year.name,
      section_key: `${chain.klass.name}|${chain.year.name}|${chain.year.name}|A`,
      ...overrides,
    };
  }

  describe('upsert', () => {
    it('creates a new enrollment', async () => {
      const chain = await seedChain(TENANT_A, 'cr');
      const row = rowFor(chain);

      const created = await enrollmentsTab.upsert(row, null, TENANT_A, dataSource.manager);

      const saved = await enrollmentRepo.findOneByOrFail({ id: created.id });
      expect(saved.student_id).toBe(chain.student.id);
      expect(saved.class_id).toBe(chain.klass.id);
      expect(saved.academic_year_id).toBe(chain.year.id);
      expect(saved.section_id).toBe(chain.section.id);
      expect(saved.enrollment_status).toBe(EnrollmentStatus.ACTIVE);
      expect(saved.tenant_id).toBe(TENANT_A);
    });

    it('updates a single field on an existing enrollment', async () => {
      const chain = await seedChain(TENANT_A, 'up');
      const existing = await enrollmentsTab.upsert(
        rowFor(chain),
        null,
        TENANT_A,
        dataSource.manager,
      );

      const updated = await enrollmentsTab.upsert(
        rowFor(chain, { id: existing.id, enrollment_status: EnrollmentStatus.GRADUATED }),
        existing,
        TENANT_A,
        dataSource.manager,
      );

      const saved = await enrollmentRepo.findOneByOrFail({ id: updated.id });
      expect(saved.enrollment_status).toBe(EnrollmentStatus.GRADUATED);
      expect(saved.class_id).toBe(chain.klass.id);
    });
  });

  describe('remove', () => {
    it('hard-deletes: no row survives, even with withDeleted', async () => {
      const chain = await seedChain(TENANT_A, 'rm');
      const created = await enrollmentsTab.upsert(
        rowFor(chain),
        null,
        TENANT_A,
        dataSource.manager,
      );

      await enrollmentsTab.remove(created, dataSource.manager);

      const gone = await enrollmentRepo.findOne({ where: { id: created.id }, withDeleted: true });
      expect(gone).toBeNull();
    });
  });

  describe('load', () => {
    it('never returns a tenant B enrollment when loading tenant A', async () => {
      const chainA = await seedChain(TENANT_A, 'la');
      const createdA = await enrollmentsTab.upsert(
        rowFor(chainA),
        null,
        TENANT_A,
        dataSource.manager,
      );
      const chainB = await seedChain(TENANT_B, 'lb');
      await enrollmentsTab.upsert(rowFor(chainB), null, TENANT_B, dataSource.manager);

      const loaded = await enrollmentsTab.load(TENANT_A, dataSource.manager);

      expect(loaded.map((e) => e.id)).toEqual([createdA.id]);
    });
  });

  describe('ACTIVE flip scoping', () => {
    // Two pre-existing rows for the same (student, academic_year) is not
    // something `enrollmentsTab.upsert`'s own fallback lookup would ever
    // produce on its own (that lookup already dedups on the same scope) —
    // it models the real hazard: legacy/duplicate data already sitting in
    // the table when a restore runs. Both rows are inserted directly via
    // the repo, and `upsert` is called with `existing` passed explicitly
    // (as the registry framework would after a natural-key match), so the
    // tab's own fallback `findOne` is bypassed and the flip logic is what's
    // under test.
    it('flips another ACTIVE enrollment for the same student+year to INACTIVE', async () => {
      const chain = await seedChain(TENANT_A, 'fs');
      const first = await enrollmentRepo.save(
        enrollmentRepo.create({
          student_id: chain.student.id,
          class_id: chain.klass.id,
          academic_year_id: chain.year.id,
          section_id: chain.section.id,
          enrollment_status: EnrollmentStatus.ACTIVE,
          enrolled_at: new Date('2026-01-15T00:00:00.000Z'),
          tenant_id: TENANT_A,
        }),
      );
      const second = await enrollmentRepo.save(
        enrollmentRepo.create({
          student_id: chain.student.id,
          class_id: chain.klass.id,
          academic_year_id: chain.year.id,
          section_id: chain.section.id,
          enrollment_status: EnrollmentStatus.INACTIVE,
          enrolled_at: new Date('2026-02-01T00:00:00.000Z'),
          tenant_id: TENANT_A,
        }),
      );

      await enrollmentsTab.upsert(
        rowFor(chain, { id: second.id, enrollment_status: EnrollmentStatus.ACTIVE }),
        second,
        TENANT_A,
        dataSource.manager,
      );

      const firstReloaded = await enrollmentRepo.findOneByOrFail({ id: first.id });
      const secondReloaded = await enrollmentRepo.findOneByOrFail({ id: second.id });
      expect(firstReloaded.enrollment_status).toBe(EnrollmentStatus.INACTIVE);
      expect(secondReloaded.enrollment_status).toBe(EnrollmentStatus.ACTIVE);

      const activeCount = await enrollmentRepo.count({
        where: {
          tenant_id: TENANT_A,
          student_id: chain.student.id,
          academic_year_id: chain.year.id,
          enrollment_status: EnrollmentStatus.ACTIVE,
        },
      });
      expect(activeCount).toBe(1);
    });

    it('does NOT flip an ACTIVE enrollment in a different academic year for the same student', async () => {
      // Same student, two years: Y1 and Y2. The unique index scopes by
      // (student_id, academic_year_id), so both years may hold an ACTIVE
      // row simultaneously. Regression guard for Plan correction 1: a
      // student-only flip would wrongly deactivate the Y1 row here.
      const y1 = await seedChain(TENANT_A, 'y1', '2024');
      const klass2 = await classRepo.save(
        classRepo.create({
          name: 'Six-y2',
          numeric_grade: 6,
          academic_year_id: (
            await yearRepo.save(
              yearRepo.create({
                name: '2025',
                start_date: new Date('2025-01-01'),
                end_date: new Date('2025-12-31'),
                is_current: false,
                tenant_id: TENANT_A,
              }),
            )
          ).id,
          tenant_id: TENANT_A,
        }),
      );
      const year2 = await yearRepo.findOneByOrFail({ id: klass2.academic_year_id });
      const section2 = await sectionRepo.save(
        sectionRepo.create({
          class_id: klass2.id,
          section_name: 'A',
          capacity: null,
          tenant_id: TENANT_A,
        }),
      );
      const chainY2: Chain = { year: year2, klass: klass2, section: section2, student: y1.student };

      const enrollmentY1 = await enrollmentsTab.upsert(
        rowFor(y1),
        null,
        TENANT_A,
        dataSource.manager,
      );
      expect(enrollmentY1.enrollment_status).toBe(EnrollmentStatus.ACTIVE);

      await enrollmentsTab.upsert(
        rowFor(chainY2, { id: '00000000-0000-4000-8000-000000000003' }),
        null,
        TENANT_A,
        dataSource.manager,
      );

      const y1Reloaded = await enrollmentRepo.findOneByOrFail({ id: enrollmentY1.id });
      expect(y1Reloaded.enrollment_status).toBe(EnrollmentStatus.ACTIVE);
    });

    it('does NOT flip an ACTIVE enrollment in a different tenant', async () => {
      // Note: a `student_id` is a real foreign key into one tenant's own
      // `students` row, so two tenants can never legitimately share one —
      // this can't be strengthened into "same student_id, different tenant"
      // without breaking that invariant. It stays a smoke test for the
      // `tenant_id` clause in the flip's WHERE; the same-year/cross-year
      // tests above are what actually prove the scope is exact.
      const chainA = await seedChain(TENANT_A, 'ta');
      const chainB = await seedChain(TENANT_B, 'tb');

      const enrollmentB = await enrollmentsTab.upsert(
        rowFor(chainB),
        null,
        TENANT_B,
        dataSource.manager,
      );
      await enrollmentsTab.upsert(rowFor(chainA), null, TENANT_A, dataSource.manager);

      const bReloaded = await enrollmentRepo.findOneByOrFail({ id: enrollmentB.id });
      expect(bReloaded.enrollment_status).toBe(EnrollmentStatus.ACTIVE);
    });

    it('a non-ACTIVE upsert flips nothing', async () => {
      const chain = await seedChain(TENANT_A, 'na');
      const first = await enrollmentRepo.save(
        enrollmentRepo.create({
          student_id: chain.student.id,
          class_id: chain.klass.id,
          academic_year_id: chain.year.id,
          section_id: chain.section.id,
          enrollment_status: EnrollmentStatus.ACTIVE,
          enrolled_at: new Date('2026-01-15T00:00:00.000Z'),
          tenant_id: TENANT_A,
        }),
      );
      const second = await enrollmentRepo.save(
        enrollmentRepo.create({
          student_id: chain.student.id,
          class_id: chain.klass.id,
          academic_year_id: chain.year.id,
          section_id: chain.section.id,
          enrollment_status: EnrollmentStatus.INACTIVE,
          enrolled_at: new Date('2026-02-01T00:00:00.000Z'),
          tenant_id: TENANT_A,
        }),
      );

      await enrollmentsTab.upsert(
        rowFor(chain, { id: second.id, enrollment_status: EnrollmentStatus.INACTIVE }),
        second,
        TENANT_A,
        dataSource.manager,
      );

      const firstReloaded = await enrollmentRepo.findOneByOrFail({ id: first.id });
      expect(firstReloaded.enrollment_status).toBe(EnrollmentStatus.ACTIVE);
    });
  });
});
