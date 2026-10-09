import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DataSource, Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { School } from '../src/modules/schools/entities/school.entity';
import { AcademicYear } from '../src/modules/academics/entities/academic-year.entity';
import { Class } from '../src/modules/academics/entities/class.entity';
import { ClassSection } from '../src/modules/academics/entities/class-section.entity';
import { Student } from '../src/modules/students/entities/student.entity';
import { Enrollment } from '../src/modules/students/entities/enrollment.entity';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { BackfillMissingEnrollments1789800015000 } from '../src/migrations/1789800015000-BackfillMissingEnrollments';

/**
 * [#1020] Runs against the real migrated schema (`createTestModule`'s
 * default `synchronize: false`), because this migration's `up()` is raw SQL
 * against actual tables/indexes — a `synchronize: true` schema built from
 * entity metadata would silently diverge from what production runs.
 *
 * The global test run already applies every migration once, including this
 * one, against an empty `students` table, so it inserts nothing at that
 * point. This spec re-runs `up()` directly against a student it creates
 * without an `Enrollment` row (bypassing `StudentService.create`, which
 * always writes one) to exercise the actual backfill.
 */
describe('BackfillMissingEnrollments1789800015000 (integration)', () => {
  let dataSource: DataSource;
  let schoolRepo: Repository<School>;
  let yearRepo: Repository<AcademicYear>;
  let classRepo: Repository<Class>;
  let sectionRepo: Repository<ClassSection>;
  let studentRepo: Repository<Student>;
  let enrollmentRepo: Repository<Enrollment>;

  const TENANT_ID = '33333333-3333-4333-8333-333333333333';

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    dataSource = module.get(DataSource);
    schoolRepo = module.get(getRepositoryToken(School));
    yearRepo = module.get(getRepositoryToken(AcademicYear));
    classRepo = module.get(getRepositoryToken(Class));
    sectionRepo = module.get(getRepositoryToken(ClassSection));
    studentRepo = module.get(getRepositoryToken(Student));
    enrollmentRepo = module.get(getRepositoryToken(Enrollment));
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM enrollments WHERE tenant_id = $1', [TENANT_ID]);
    await dataSource.query('DELETE FROM students WHERE tenant_id = $1', [TENANT_ID]);
    await dataSource.query('DELETE FROM class_sections WHERE tenant_id = $1', [TENANT_ID]);
    await dataSource.query('DELETE FROM classes WHERE tenant_id = $1', [TENANT_ID]);
    await dataSource.query('DELETE FROM academic_years WHERE tenant_id = $1', [TENANT_ID]);
    await dataSource.query('DELETE FROM schools WHERE id = $1', [TENANT_ID]);

    await schoolRepo.save(
      schoolRepo.create({ id: TENANT_ID, name: 'Backfill Test School', slug: 'backfill-test' }),
    );
  });

  it('backfills a missing ACTIVE Enrollment for an ACTIVE student, and is a no-op on rerun', async () => {
    const year = await yearRepo.save(
      yearRepo.create({
        name: '2026-bf',
        start_date: new Date('2026-01-01'),
        end_date: new Date('2026-12-31'),
        is_current: true,
        tenant_id: TENANT_ID,
      }),
    );
    const klass = await classRepo.save(
      classRepo.create({
        name: 'Backfill Class',
        numeric_grade: 6,
        academic_year_id: year.id,
        tenant_id: TENANT_ID,
      }),
    );
    const section = await sectionRepo.save(
      sectionRepo.create({ class_id: klass.id, section_name: 'A', tenant_id: TENANT_ID }),
    );
    // Written directly against the repository, not `StudentService.create`,
    // so no `Enrollment` row exists yet — the exact gap this migration closes.
    const student = await studentRepo.save(
      studentRepo.create({
        full_name: 'Gap Student',
        registration_number: 'BF-0001',
        roll_number: 1,
        class_section_id: section.id,
        tenant_id: TENANT_ID,
      }),
    );

    const migration = new BackfillMissingEnrollments1789800015000();
    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    try {
      await migration.up(queryRunner);
    } finally {
      await queryRunner.release();
    }

    const enrollments = await enrollmentRepo.find({ where: { student_id: student.id } });
    expect(enrollments).toHaveLength(1);
    expect(enrollments[0].class_id).toBe(klass.id);
    expect(enrollments[0].section_id).toBe(section.id);
    expect(enrollments[0].academic_year_id).toBe(year.id);
    expect(enrollments[0].enrollment_status).toBe('ACTIVE');

    // Second run: ON CONFLICT DO NOTHING means no duplicate row.
    const queryRunner2 = dataSource.createQueryRunner();
    await queryRunner2.connect();
    try {
      await migration.up(queryRunner2);
    } finally {
      await queryRunner2.release();
    }

    const afterRerun = await enrollmentRepo.find({ where: { student_id: student.id } });
    expect(afterRerun).toHaveLength(1);
    expect(afterRerun[0].id).toBe(enrollments[0].id);
  });

  it('leaves an already-enrolled ACTIVE student alone', async () => {
    const year = await yearRepo.save(
      yearRepo.create({
        name: '2026-bf2',
        start_date: new Date('2026-01-01'),
        end_date: new Date('2026-12-31'),
        is_current: true,
        tenant_id: TENANT_ID,
      }),
    );
    const klass = await classRepo.save(
      classRepo.create({
        name: 'Backfill Class 2',
        numeric_grade: 6,
        academic_year_id: year.id,
        tenant_id: TENANT_ID,
      }),
    );
    const section = await sectionRepo.save(
      sectionRepo.create({ class_id: klass.id, section_name: 'A', tenant_id: TENANT_ID }),
    );
    const student = await studentRepo.save(
      studentRepo.create({
        full_name: 'Already Enrolled',
        registration_number: 'BF-0002',
        roll_number: 1,
        class_section_id: section.id,
        tenant_id: TENANT_ID,
      }),
    );
    const existingEnrollment = await enrollmentRepo.save(
      enrollmentRepo.create({
        student_id: student.id,
        class_id: klass.id,
        section_id: section.id,
        academic_year_id: year.id,
        tenant_id: TENANT_ID,
      }),
    );

    const migration = new BackfillMissingEnrollments1789800015000();
    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    try {
      await migration.up(queryRunner);
    } finally {
      await queryRunner.release();
    }

    const enrollments = await enrollmentRepo.find({ where: { student_id: student.id } });
    expect(enrollments).toHaveLength(1);
    expect(enrollments[0].id).toBe(existingEnrollment.id);
  });

  it('does not backfill a student whose class_section_id names another tenant`s section', async () => {
    const OTHER_TENANT_ID = '44444444-4444-4444-8444-444444444444';
    await schoolRepo.save(
      schoolRepo.create({ id: OTHER_TENANT_ID, name: 'Other Tenant', slug: 'backfill-other' }),
    );
    const otherYear = await yearRepo.save(
      yearRepo.create({
        name: '2026-other',
        start_date: new Date('2026-01-01'),
        end_date: new Date('2026-12-31'),
        is_current: true,
        tenant_id: OTHER_TENANT_ID,
      }),
    );
    const otherClass = await classRepo.save(
      classRepo.create({
        name: 'Other Tenant Class',
        numeric_grade: 6,
        academic_year_id: otherYear.id,
        tenant_id: OTHER_TENANT_ID,
      }),
    );
    const otherSection = await sectionRepo.save(
      sectionRepo.create({
        class_id: otherClass.id,
        section_name: 'A',
        tenant_id: OTHER_TENANT_ID,
      }),
    );

    // Tenant A student whose class_section_id happens to name a section
    // that belongs to a different tenant (shouldn't be reachable in
    // practice, but the migration's join must not trust it regardless).
    const student = await studentRepo.save(
      studentRepo.create({
        full_name: 'Cross Tenant Student',
        registration_number: 'BF-0003',
        roll_number: 1,
        class_section_id: otherSection.id,
        tenant_id: TENANT_ID,
      }),
    );

    const migration = new BackfillMissingEnrollments1789800015000();
    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    try {
      await migration.up(queryRunner);
    } finally {
      await queryRunner.release();
    }

    const enrollments = await enrollmentRepo.find({ where: { student_id: student.id } });
    expect(enrollments).toHaveLength(0);

    await dataSource.query('DELETE FROM students WHERE id = $1', [student.id]);
    await dataSource.query('DELETE FROM class_sections WHERE tenant_id = $1', [OTHER_TENANT_ID]);
    await dataSource.query('DELETE FROM classes WHERE tenant_id = $1', [OTHER_TENANT_ID]);
    await dataSource.query('DELETE FROM academic_years WHERE tenant_id = $1', [OTHER_TENANT_ID]);
    await dataSource.query('DELETE FROM schools WHERE id = $1', [OTHER_TENANT_ID]);
  });
});
