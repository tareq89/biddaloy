import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource, Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { TestingModule } from '@nestjs/testing';
import { School } from '../../../schools/entities/school.entity';
import { AcademicYear } from '../../../academics/entities/academic-year.entity';
import { Class } from '../../../academics/entities/class.entity';
import { ClassSection } from '../../../academics/entities/class-section.entity';
import { Student } from '../../../students/entities/student.entity';
import { FeeStructure } from '../../../fees/entities/fee-structure.entity';
import { FeeStructureStudent } from '../../../fees/entities/fee-structure-student.entity';
import { FeeApplicability, FeeType } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { feeStructuresTab, type FeeStructureRow } from './fee-structures.tab';
import type { ImportContext } from '../../codec/tab-spec';

/**
 * Integration tests for the fees lane's tabs against a real Postgres
 * database, mirroring `academics.tabs.integration.spec.ts`.
 *
 * `students` is a forward reference to a tab this worktree does not have
 * (14.5, a different parallel group). These tests never route through that
 * tab: they insert `Student` rows directly with the real repository and
 * supply a hand-written `ImportContext` whose `ref('students', key)` looks
 * students up by `registration_number` — exactly the contract the real
 * `students.tab.ts` will implement, without depending on its existence.
 */
describe('fees tabs (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let schoolRepo: Repository<School>;
  let yearRepo: Repository<AcademicYear>;
  let classRepo: Repository<Class>;
  let sectionRepo: Repository<ClassSection>;
  let studentRepo: Repository<Student>;
  let feeStructureRepo: Repository<FeeStructure>;
  let feeStructureStudentRepo: Repository<FeeStructureStudent>;

  const TENANT_A = '11111111-1111-4111-8111-111111111111';
  const TENANT_B = '22222222-2222-4222-8222-222222222222';

  let yearAId: string;
  let classAId: string;
  let sectionAId: string;
  let studentA1: Student;
  let studentA2: Student;

  function importCtx(): ImportContext {
    return {
      tenantId: TENANT_A,
      ref: () => undefined,
      warn: () => undefined,
    };
  }

  beforeAll(async () => {
    module = await createTestModule(ALL_ENTITIES, []);
    dataSource = module.get(DataSource);
    schoolRepo = module.get<Repository<School>>(getRepositoryToken(School));
    yearRepo = module.get<Repository<AcademicYear>>(getRepositoryToken(AcademicYear));
    classRepo = module.get<Repository<Class>>(getRepositoryToken(Class));
    sectionRepo = module.get<Repository<ClassSection>>(getRepositoryToken(ClassSection));
    studentRepo = module.get<Repository<Student>>(getRepositoryToken(Student));
    feeStructureRepo = module.get<Repository<FeeStructure>>(getRepositoryToken(FeeStructure));
    feeStructureStudentRepo = module.get<Repository<FeeStructureStudent>>(
      getRepositoryToken(FeeStructureStudent),
    );
  });

  afterAll(async () => {
    await module?.close();
  });

  beforeEach(async () => {
    await feeStructureStudentRepo.createQueryBuilder().delete().execute();
    await feeStructureRepo.delete({ tenant_id: TENANT_A });
    await feeStructureRepo.delete({ tenant_id: TENANT_B });
    await studentRepo.delete({ tenant_id: TENANT_A });
    await studentRepo.delete({ tenant_id: TENANT_B });
    await sectionRepo.delete({ tenant_id: TENANT_A });
    await sectionRepo.delete({ tenant_id: TENANT_B });
    await classRepo.delete({ tenant_id: TENANT_A });
    await classRepo.delete({ tenant_id: TENANT_B });
    await yearRepo.delete({ tenant_id: TENANT_A });
    await yearRepo.delete({ tenant_id: TENANT_B });
    await schoolRepo.delete({ id: TENANT_A });
    await schoolRepo.delete({ id: TENANT_B });

    await schoolRepo.save(
      schoolRepo.create({ id: TENANT_A, name: 'Tenant A School', slug: 'tenant-a-fees' }),
    );
    await schoolRepo.save(
      schoolRepo.create({ id: TENANT_B, name: 'Tenant B School', slug: 'tenant-b-fees' }),
    );

    const year = await yearRepo.save(
      yearRepo.create({ tenant_id: TENANT_A, name: '2026-2027', start_date: '2026-01-01', end_date: '2026-12-31', is_current: true }),
    );
    yearAId = year.id;

    const klass = await classRepo.save(
      classRepo.create({ tenant_id: TENANT_A, name: 'Class 5', academic_year_id: yearAId }),
    );
    classAId = klass.id;

    const section = await sectionRepo.save(
      sectionRepo.create({ tenant_id: TENANT_A, class_id: classAId, section_name: 'A', capacity: 40 }),
    );
    sectionAId = section.id;

    studentA1 = await studentRepo.save(
      studentRepo.create({
        tenant_id: TENANT_A,
        full_name: 'Student One',
        registration_number: 'REG-A-001',
        roll_number: 1,
        class_section_id: sectionAId,
      }),
    );
    studentA2 = await studentRepo.save(
      studentRepo.create({
        tenant_id: TENANT_A,
        full_name: 'Student Two',
        registration_number: 'REG-A-002',
        roll_number: 2,
        class_section_id: sectionAId,
      }),
    );
  });

  describe('fee_structures', () => {
    function rowFor(overrides: Partial<FeeStructureRow> = {}): FeeStructureRow {
      return {
        id: '00000000-0000-4000-8000-000000000001',
        name: 'Tuition - January',
        fee_type: FeeType.MONTHLY_TUITION,
        amount: '1500.00',
        applicability: FeeApplicability.SELECTED,
        class_id: classAId,
        class_key: 'Class 5|2026-2027',
        academic_year_id: yearAId,
        academic_year_key: '2026-2027',
        section_id: sectionAId,
        section_key: 'Class 5|2026-2027|A',
        month: 1,
        is_recurring: true,
        selected_student_ids: [studentA1.id, studentA2.id],
        selected_student_keys: ['REG-A-001', 'REG-A-002'],
        ...overrides,
      };
    }

    it('upsert creates a new row and the selected-student pivot', async () => {
      const created = await feeStructuresTab.upsert(rowFor(), null, TENANT_A, dataSource.manager);
      expect(created.id).toBeDefined();
      expect(created.tenant_id).toBe(TENANT_A);

      const links = await feeStructureStudentRepo.find({ where: { fee_structure_id: created.id } });
      expect(links.map((l) => l.student_id).sort()).toEqual([studentA1.id, studentA2.id].sort());
    });

    it('upsert with a changed field updates only that field', async () => {
      const created = await feeStructuresTab.upsert(rowFor(), null, TENANT_A, dataSource.manager);
      const updated = await feeStructuresTab.upsert(
        rowFor({ amount: '2000.00' }),
        created,
        TENANT_A,
        dataSource.manager,
      );
      expect(updated.amount).toBe('2000.00');
      expect(updated.name).toBe('Tuition - January');
    });

    it('upsert replaces selected_students to match the row', async () => {
      const created = await feeStructuresTab.upsert(rowFor(), null, TENANT_A, dataSource.manager);
      const updated = await feeStructuresTab.upsert(
        rowFor({ selected_student_ids: [studentA1.id], selected_student_keys: ['REG-A-001'] }),
        created,
        TENANT_A,
        dataSource.manager,
      );
      const links = await feeStructureStudentRepo.find({ where: { fee_structure_id: updated.id } });
      expect(links.map((l) => l.student_id)).toEqual([studentA1.id]);
    });

    it('remove soft-deletes', async () => {
      const created = await feeStructuresTab.upsert(rowFor(), null, TENANT_A, dataSource.manager);
      await feeStructuresTab.remove(created, dataSource.manager);
      const found = await feeStructureRepo.findOne({ where: { id: created.id }, withDeleted: true });
      expect(found?.deleted_at).not.toBeNull();
    });

    it('load(tenantA) never returns tenant B rows', async () => {
      await feeStructuresTab.upsert(rowFor(), null, TENANT_A, dataSource.manager);
      const rowsA = await feeStructuresTab.load(TENANT_A, dataSource.manager);
      const rowsB = await feeStructuresTab.load(TENANT_B, dataSource.manager);
      expect(rowsA.length).toBe(1);
      expect(rowsB.length).toBe(0);
    });

    it('fromRow resolves selected_students via a real student registration_number lookup', () => {
      const ctx: ImportContext = {
        ...importCtx(),
        ref: (tab, key) => {
          if (tab === 'classes' && key === 'Class 5|2026-2027') return classAId;
          if (tab === 'academic_years' && key === '2026-2027') return yearAId;
          if (tab === 'sections' && key === 'Class 5|2026-2027|A') return sectionAId;
          if (tab === 'students' && key === studentA1.registration_number) return studentA1.id;
          if (tab === 'students' && key === studentA2.registration_number) return studentA2.id;
          return undefined;
        },
      };
      const result = feeStructuresTab.fromRow(
        {
          id: '00000000-0000-4000-8000-000000000001',
          name: 'Tuition',
          fee_type: FeeType.MONTHLY_TUITION,
          amount: '1500.00',
          applicability: FeeApplicability.SELECTED,
          class: 'Class 5|2026-2027',
          academic_year: '2026-2027',
          section: 'Class 5|2026-2027|A',
          month: '1',
          is_recurring: 'TRUE',
          selected_students: `${studentA1.registration_number};${studentA2.registration_number}`,
        },
        2,
        ctx,
      );
      expect('row' in result).toBe(true);
      const row = (result as { row: FeeStructureRow }).row;
      expect(row.selected_student_ids).toEqual([studentA1.id, studentA2.id]);
    });
  });
});
