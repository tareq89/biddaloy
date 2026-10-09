import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource, Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { TestingModule } from '@nestjs/testing';
import { ProgramEnrollmentStatus } from '@biddaloy/shared';
import { School } from '../../../schools/entities/school.entity';
import { AcademicYear } from '../../../academics/entities/academic-year.entity';
import { Class } from '../../../academics/entities/class.entity';
import { ClassSection } from '../../../academics/entities/class-section.entity';
import { Student } from '../../../students/entities/student.entity';
import { Program } from '../../../programs/entities/program.entity';
import { ProgramMilestone } from '../../../programs/entities/program-milestone.entity';
import { ProgramEnrollment } from '../../../programs/entities/program-enrollment.entity';
import { MilestoneAchievement } from '../../../programs/entities/milestone-achievement.entity';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import type { ImportContext } from '../../codec/tab-spec';
import { programsTab, type ProgramRow } from './programs.tab';
import { programMilestonesTab, type ProgramMilestoneRow } from './program-milestones.tab';
import { programEnrollmentsTab, type ProgramEnrollmentRow } from './program-enrollments.tab';
import {
  milestoneAchievementsTab,
  type MilestoneAchievementRow,
} from './milestone-achievements.tab';

/**
 * Integration tests for the programs lane's four tabs (Epic 34.0, [34.1.4])
 * against a real Postgres database, mirroring
 * `academics.tabs.integration.spec.ts`: the pure mapping is covered by unit
 * tests elsewhere in the codec (`fromCell`/`toCell`), what needs a real table
 * is that `upsert` only ever writes the addressed tenant's rows, that
 * `remove` really deletes (none of these four entities soft-deletes), and
 * that a `fromRow` ref error names the tab and column that failed.
 */
describe('programs tabs (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let schoolRepo: Repository<School>;
  let yearRepo: Repository<AcademicYear>;
  let classRepo: Repository<Class>;
  let sectionRepo: Repository<ClassSection>;
  let studentRepo: Repository<Student>;
  let programRepo: Repository<Program>;
  let milestoneRepo: Repository<ProgramMilestone>;
  let enrollmentRepo: Repository<ProgramEnrollment>;
  let achievementRepo: Repository<MilestoneAchievement>;

  const TENANT_A = '31111111-1111-4111-8111-111111111111';
  const TENANT_B = '32222222-2222-4222-8222-222222222222';

  beforeAll(async () => {
    module = await createTestModule(ALL_ENTITIES, []);
    dataSource = module.get(DataSource);
    schoolRepo = module.get<Repository<School>>(getRepositoryToken(School));
    yearRepo = module.get<Repository<AcademicYear>>(getRepositoryToken(AcademicYear));
    classRepo = module.get<Repository<Class>>(getRepositoryToken(Class));
    sectionRepo = module.get<Repository<ClassSection>>(getRepositoryToken(ClassSection));
    studentRepo = module.get<Repository<Student>>(getRepositoryToken(Student));
    programRepo = module.get<Repository<Program>>(getRepositoryToken(Program));
    milestoneRepo = module.get<Repository<ProgramMilestone>>(getRepositoryToken(ProgramMilestone));
    enrollmentRepo = module.get<Repository<ProgramEnrollment>>(
      getRepositoryToken(ProgramEnrollment),
    );
    achievementRepo = module.get<Repository<MilestoneAchievement>>(
      getRepositoryToken(MilestoneAchievement),
    );
  });

  afterAll(async () => {
    await module?.close();
  });

  beforeEach(async () => {
    // Children before parents, both tenants.
    await achievementRepo.delete({ tenant_id: TENANT_A });
    await achievementRepo.delete({ tenant_id: TENANT_B });
    await enrollmentRepo.delete({ tenant_id: TENANT_A });
    await enrollmentRepo.delete({ tenant_id: TENANT_B });
    await milestoneRepo.delete({ tenant_id: TENANT_A });
    await milestoneRepo.delete({ tenant_id: TENANT_B });
    await programRepo.delete({ tenant_id: TENANT_A });
    await programRepo.delete({ tenant_id: TENANT_B });
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
      schoolRepo.create({ id: TENANT_A, name: 'Tenant A School', slug: 'tenant-a-programs' }),
    );
    await schoolRepo.save(
      schoolRepo.create({ id: TENANT_B, name: 'Tenant B School', slug: 'tenant-b-programs' }),
    );
  });

  async function seedStudent(tenantId: string, idSuffix: string): Promise<Student> {
    const year = await yearRepo.save(
      yearRepo.create({
        tenant_id: tenantId,
        name: `Year ${idSuffix}`,
        start_date: '2026-01-01',
        end_date: '2026-12-31',
        is_current: true,
      }),
    );
    const klass = await classRepo.save(
      classRepo.create({
        tenant_id: tenantId,
        name: `Class ${idSuffix}`,
        academic_year_id: year.id,
      }),
    );
    const section = await sectionRepo.save(
      sectionRepo.create({
        tenant_id: tenantId,
        class_id: klass.id,
        section_name: 'A',
      }),
    );
    return studentRepo.save(
      studentRepo.create({
        tenant_id: tenantId,
        registration_number: `REG-${idSuffix}`,
        roll_number: 1,
        full_name: `Student ${idSuffix}`,
        date_of_birth: new Date('2015-01-01'),
        gender: 'MALE',
        class_section_id: section.id,
      }),
    );
  }

  describe('programs', () => {
    function rowFor(overrides: Partial<ProgramRow> = {}): ProgramRow {
      return {
        id: '00000000-0000-4000-8000-000000000101',
        name: 'Hifz',
        description: null,
        is_active: true,
        show_on_report_card: true,
        ...overrides,
      };
    }

    it('upsert creates a new row', async () => {
      const created = await programsTab.upsert(rowFor(), null, TENANT_A, dataSource.manager);

      const saved = await programRepo.findOneByOrFail({ id: created.id });
      expect(saved.name).toBe('Hifz');
      expect(saved.show_on_report_card).toBe(true);
      expect(saved.tenant_id).toBe(TENANT_A);
    });

    it('upsert with one changed field updates only that field', async () => {
      const existing = await programsTab.upsert(rowFor(), null, TENANT_A, dataSource.manager);

      await programsTab.upsert(
        rowFor({ id: existing.id, is_active: false }),
        existing,
        TENANT_A,
        dataSource.manager,
      );

      const updated = await programRepo.findOneByOrFail({ id: existing.id });
      expect(updated.is_active).toBe(false);
      expect(updated.name).toBe('Hifz');
    });

    it('remove deletes the program', async () => {
      const existing = await programsTab.upsert(rowFor(), null, TENANT_A, dataSource.manager);

      await programsTab.remove(existing, dataSource.manager);

      expect(await programRepo.findOneBy({ id: existing.id })).toBeNull();
    });

    it("load never returns another tenant's rows", async () => {
      await programsTab.upsert(rowFor(), null, TENANT_A, dataSource.manager);
      await programsTab.upsert(
        rowFor({ id: '00000000-0000-4000-8000-000000000102' }),
        null,
        TENANT_B,
        dataSource.manager,
      );

      const loaded = await programsTab.load(TENANT_A, dataSource.manager);

      expect(loaded).toHaveLength(1);
      expect(loaded[0].tenant_id).toBe(TENANT_A);
    });
  });

  describe('program_milestones', () => {
    async function seedProgram(tenantId: string, idSuffix: string): Promise<Program> {
      return programRepo.save(
        programRepo.create({
          tenant_id: tenantId,
          name: `Program ${idSuffix}`,
          is_active: true,
          show_on_report_card: false,
        }),
      );
    }

    function rowFor(
      programId: string,
      overrides: Partial<ProgramMilestoneRow> = {},
    ): ProgramMilestoneRow {
      return {
        id: '00000000-0000-4000-8000-000000000110',
        program_id: programId,
        name: 'Para 1',
        description: null,
        sequence: 1,
        program_key: 'unused-in-upsert',
        ...overrides,
      };
    }

    it('upsert creates a new row', async () => {
      const program = await seedProgram(TENANT_A, '120');

      const created = await programMilestonesTab.upsert(
        rowFor(program.id),
        null,
        TENANT_A,
        dataSource.manager,
      );

      const saved = await milestoneRepo.findOneByOrFail({ id: created.id });
      expect(saved.name).toBe('Para 1');
      expect(saved.program_id).toBe(program.id);
      expect(saved.tenant_id).toBe(TENANT_A);
    });

    it('upsert with one changed field updates only that field', async () => {
      const program = await seedProgram(TENANT_A, '121');
      const existing = await programMilestonesTab.upsert(
        rowFor(program.id),
        null,
        TENANT_A,
        dataSource.manager,
      );

      await programMilestonesTab.upsert(
        rowFor(program.id, { id: existing.id, name: 'Para 1 (revised)' }),
        existing,
        TENANT_A,
        dataSource.manager,
      );

      const updated = await milestoneRepo.findOneByOrFail({ id: existing.id });
      expect(updated.name).toBe('Para 1 (revised)');
      expect(updated.sequence).toBe(1);
    });

    it('remove deletes the milestone', async () => {
      const program = await seedProgram(TENANT_A, '122');
      const existing = await programMilestonesTab.upsert(
        rowFor(program.id),
        null,
        TENANT_A,
        dataSource.manager,
      );

      await programMilestonesTab.remove(existing, dataSource.manager);

      expect(await milestoneRepo.findOneBy({ id: existing.id })).toBeNull();
    });

    it("load never returns another tenant's rows", async () => {
      const programA = await seedProgram(TENANT_A, '123');
      const programB = await seedProgram(TENANT_B, '124');
      await programMilestonesTab.upsert(rowFor(programA.id), null, TENANT_A, dataSource.manager);
      await programMilestonesTab.upsert(
        rowFor(programB.id, { id: '00000000-0000-4000-8000-000000000111' }),
        null,
        TENANT_B,
        dataSource.manager,
      );

      const loaded = await programMilestonesTab.load(TENANT_A, dataSource.manager);

      expect(loaded).toHaveLength(1);
      expect(loaded[0].tenant_id).toBe(TENANT_A);
      // `load` eagerly joins `program` for `keyOf`'s natural-key text.
      expect(loaded[0].program?.id).toBe(programA.id);
    });

    it('a "program" ref error names the tab and column', () => {
      const warnings: unknown[] = [];
      const ctx: ImportContext = {
        tenantId: TENANT_A,
        ref: () => undefined,
        warn: (e) => warnings.push(e),
      };

      const result = programMilestonesTab.fromRow(
        {
          id: '00000000-0000-4000-8000-000000000112',
          program: 'Nonexistent',
          name: 'X',
          sequence: '1',
        },
        2,
        ctx,
      );

      expect('errors' in result).toBe(true);
      if ('errors' in result) {
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toMatchObject({
          tab: 'program_milestones',
          column: 'program',
          row: 2,
        });
      }
    });
  });

  describe('program_enrollments', () => {
    async function seedProgramAndStudent(
      tenantId: string,
      idSuffix: string,
    ): Promise<{ program: Program; student: Student }> {
      const program = await programRepo.save(
        programRepo.create({
          tenant_id: tenantId,
          name: `Program ${idSuffix}`,
          is_active: true,
          show_on_report_card: false,
        }),
      );
      const student = await seedStudent(tenantId, idSuffix);
      return { program, student };
    }

    function rowFor(
      programId: string,
      studentId: string,
      overrides: Partial<ProgramEnrollmentRow> = {},
    ): ProgramEnrollmentRow {
      return {
        id: '00000000-0000-4000-8000-000000000130',
        program_id: programId,
        student_id: studentId,
        started_on: '2026-01-05',
        ended_on: null,
        status: ProgramEnrollmentStatus.ACTIVE,
        program_key: 'unused-in-upsert',
        student_key: 'unused-in-upsert',
        ...overrides,
      };
    }

    it('upsert creates a new row', async () => {
      const { program, student } = await seedProgramAndStudent(TENANT_A, '140');

      const created = await programEnrollmentsTab.upsert(
        rowFor(program.id, student.id),
        null,
        TENANT_A,
        dataSource.manager,
      );

      const saved = await enrollmentRepo.findOneByOrFail({ id: created.id });
      expect(saved.program_id).toBe(program.id);
      expect(saved.student_id).toBe(student.id);
      expect(saved.status).toBe(ProgramEnrollmentStatus.ACTIVE);
    });

    it('upsert with one changed field updates only that field', async () => {
      const { program, student } = await seedProgramAndStudent(TENANT_A, '141');
      const existing = await programEnrollmentsTab.upsert(
        rowFor(program.id, student.id),
        null,
        TENANT_A,
        dataSource.manager,
      );

      await programEnrollmentsTab.upsert(
        rowFor(program.id, student.id, {
          id: existing.id,
          status: ProgramEnrollmentStatus.COMPLETED,
          ended_on: '2026-06-01',
        }),
        existing,
        TENANT_A,
        dataSource.manager,
      );

      const updated = await enrollmentRepo.findOneByOrFail({ id: existing.id });
      expect(updated.status).toBe(ProgramEnrollmentStatus.COMPLETED);
      expect(String(updated.ended_on).slice(0, 10)).toBe('2026-06-01');
    });

    it('remove deletes the enrollment', async () => {
      const { program, student } = await seedProgramAndStudent(TENANT_A, '142');
      const existing = await programEnrollmentsTab.upsert(
        rowFor(program.id, student.id),
        null,
        TENANT_A,
        dataSource.manager,
      );

      await programEnrollmentsTab.remove(existing, dataSource.manager);

      expect(await enrollmentRepo.findOneBy({ id: existing.id })).toBeNull();
    });

    it("load never returns another tenant's rows", async () => {
      const a = await seedProgramAndStudent(TENANT_A, '143');
      const b = await seedProgramAndStudent(TENANT_B, '144');
      await programEnrollmentsTab.upsert(
        rowFor(a.program.id, a.student.id),
        null,
        TENANT_A,
        dataSource.manager,
      );
      await programEnrollmentsTab.upsert(
        rowFor(b.program.id, b.student.id, { id: '00000000-0000-4000-8000-000000000131' }),
        null,
        TENANT_B,
        dataSource.manager,
      );

      const loaded = await programEnrollmentsTab.load(TENANT_A, dataSource.manager);

      expect(loaded).toHaveLength(1);
      expect(loaded[0].tenant_id).toBe(TENANT_A);
    });
  });

  describe('milestone_achievements', () => {
    async function seedEnrollmentAndMilestone(
      tenantId: string,
      idSuffix: string,
    ): Promise<{ enrollment: ProgramEnrollment; milestone: ProgramMilestone }> {
      const program = await programRepo.save(
        programRepo.create({
          tenant_id: tenantId,
          name: `Program ${idSuffix}`,
          is_active: true,
          show_on_report_card: false,
        }),
      );
      const milestone = await milestoneRepo.save(
        milestoneRepo.create({
          tenant_id: tenantId,
          program_id: program.id,
          name: 'Para 1',
          sequence: 1,
        }),
      );
      const student = await seedStudent(tenantId, idSuffix);
      const enrollment = await enrollmentRepo.save(
        enrollmentRepo.create({
          tenant_id: tenantId,
          program_id: program.id,
          student_id: student.id,
          started_on: '2026-01-05',
          status: ProgramEnrollmentStatus.ACTIVE,
        }),
      );
      return { enrollment, milestone };
    }

    function rowFor(
      enrollmentId: string,
      milestoneId: string,
      overrides: Partial<MilestoneAchievementRow> = {},
    ): MilestoneAchievementRow {
      return {
        id: '00000000-0000-4000-8000-000000000150',
        enrollment_id: enrollmentId,
        milestone_id: milestoneId,
        achieved_on: '2026-01-15',
        recorded_by: null,
        score: '95.00',
        grade: 'A',
        remark: null,
        enrollment_key: 'unused-in-upsert',
        milestone_key: 'unused-in-upsert',
        recorded_by_key: '',
        ...overrides,
      };
    }

    it('upsert creates a new row', async () => {
      const { enrollment, milestone } = await seedEnrollmentAndMilestone(TENANT_A, '160');

      const created = await milestoneAchievementsTab.upsert(
        rowFor(enrollment.id, milestone.id),
        null,
        TENANT_A,
        dataSource.manager,
      );

      const saved = await achievementRepo.findOneByOrFail({ id: created.id });
      expect(saved.enrollment_id).toBe(enrollment.id);
      expect(saved.milestone_id).toBe(milestone.id);
      expect(saved.score).toBe('95.00');
    });

    it('upsert with one changed field updates only that field', async () => {
      const { enrollment, milestone } = await seedEnrollmentAndMilestone(TENANT_A, '161');
      const existing = await milestoneAchievementsTab.upsert(
        rowFor(enrollment.id, milestone.id),
        null,
        TENANT_A,
        dataSource.manager,
      );

      await milestoneAchievementsTab.upsert(
        rowFor(enrollment.id, milestone.id, { id: existing.id, grade: 'A+' }),
        existing,
        TENANT_A,
        dataSource.manager,
      );

      const updated = await achievementRepo.findOneByOrFail({ id: existing.id });
      expect(updated.grade).toBe('A+');
      expect(updated.score).toBe('95.00');
    });

    it('remove deletes the achievement', async () => {
      const { enrollment, milestone } = await seedEnrollmentAndMilestone(TENANT_A, '162');
      const existing = await milestoneAchievementsTab.upsert(
        rowFor(enrollment.id, milestone.id),
        null,
        TENANT_A,
        dataSource.manager,
      );

      await milestoneAchievementsTab.remove(existing, dataSource.manager);

      expect(await achievementRepo.findOneBy({ id: existing.id })).toBeNull();
    });

    it("load never returns another tenant's rows", async () => {
      const a = await seedEnrollmentAndMilestone(TENANT_A, '163');
      const b = await seedEnrollmentAndMilestone(TENANT_B, '164');
      await milestoneAchievementsTab.upsert(
        rowFor(a.enrollment.id, a.milestone.id),
        null,
        TENANT_A,
        dataSource.manager,
      );
      await milestoneAchievementsTab.upsert(
        rowFor(b.enrollment.id, b.milestone.id, { id: '00000000-0000-4000-8000-000000000151' }),
        null,
        TENANT_B,
        dataSource.manager,
      );

      const loaded = await milestoneAchievementsTab.load(TENANT_A, dataSource.manager);

      expect(loaded).toHaveLength(1);
      expect(loaded[0].tenant_id).toBe(TENANT_A);
    });

    it('an "enrollment" ref error names the tab and column', () => {
      const ctx: ImportContext = {
        tenantId: TENANT_A,
        ref: () => undefined,
        warn: () => {},
      };

      const result = milestoneAchievementsTab.fromRow(
        {
          id: '00000000-0000-4000-8000-000000000152',
          enrollment: 'Nonexistent',
          milestone: 'Nonexistent',
          achieved_on: '2026-01-15',
        },
        3,
        ctx,
      );

      expect('errors' in result).toBe(true);
      if ('errors' in result) {
        const enrollmentError = result.errors.find((e) => e.column === 'enrollment');
        expect(enrollmentError).toMatchObject({ tab: 'milestone_achievements', row: 3 });
      }
    });
  });
});
