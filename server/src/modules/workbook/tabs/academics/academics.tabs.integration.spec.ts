import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource, Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { TestingModule } from '@nestjs/testing';
import { School } from '../../../schools/entities/school.entity';
import { AcademicYear } from '../../../academics/entities/academic-year.entity';
import { Class } from '../../../academics/entities/class.entity';
import { ClassSection } from '../../../academics/entities/class-section.entity';
import { Subject } from '../../../academics/entities/subject.entity';
import { ClassSubject } from '../../../academics/entities/class-subject.entity';
import { SchoolHoliday } from '../../../academics/entities/school-holiday.entity';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { academicYearsTab, type AcademicYearRow } from './academic-years.tab';
import { classesTab, type ClassRow } from './classes.tab';
import { sectionsTab, type ClassSectionRow } from './sections.tab';
import { subjectsTab, type SubjectRow } from './subjects.tab';
import { classSubjectsTab, type ClassSubjectRow } from './class-subjects.tab';
import { holidaysTab, type HolidayRow } from './holidays.tab';

/**
 * Integration tests for the academics lane's three tabs against a real
 * Postgres database.
 *
 * The unit specs cover the pure mapping in each `.tab.ts`. What they cannot
 * cover is what actually matters for a multi-tenant restore: that `upsert`
 * only ever writes the addressed tenant's rows, that `remove` really soft-
 * deletes, and that `is_current` uniqueness survives a restore. That needs a
 * real table with more than one tenant in it — hence one shared spec file
 * for the whole lane, mirroring `school.tab.integration.spec.ts`.
 */
describe('academics tabs (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let schoolRepo: Repository<School>;
  let yearRepo: Repository<AcademicYear>;
  let classRepo: Repository<Class>;
  let sectionRepo: Repository<ClassSection>;
  let subjectRepo: Repository<Subject>;
  let classSubjectRepo: Repository<ClassSubject>;
  let holidayRepo: Repository<SchoolHoliday>;

  const TENANT_A = '11111111-1111-4111-8111-111111111111';
  const TENANT_B = '22222222-2222-4222-8222-222222222222';

  beforeAll(async () => {
    module = await createTestModule(ALL_ENTITIES, []);
    dataSource = module.get(DataSource);
    schoolRepo = module.get<Repository<School>>(getRepositoryToken(School));
    yearRepo = module.get<Repository<AcademicYear>>(getRepositoryToken(AcademicYear));
    classRepo = module.get<Repository<Class>>(getRepositoryToken(Class));
    sectionRepo = module.get<Repository<ClassSection>>(getRepositoryToken(ClassSection));
    subjectRepo = module.get<Repository<Subject>>(getRepositoryToken(Subject));
    classSubjectRepo = module.get<Repository<ClassSubject>>(getRepositoryToken(ClassSubject));
    holidayRepo = module.get<Repository<SchoolHoliday>>(getRepositoryToken(SchoolHoliday));
  });

  afterAll(async () => {
    await module?.close();
  });

  beforeEach(async () => {
    // Children before parents, both tenants.
    await holidayRepo.delete({ tenant_id: TENANT_A });
    await holidayRepo.delete({ tenant_id: TENANT_B });
    await classSubjectRepo.delete({ tenant_id: TENANT_A });
    await classSubjectRepo.delete({ tenant_id: TENANT_B });
    await subjectRepo.delete({ tenant_id: TENANT_A });
    await subjectRepo.delete({ tenant_id: TENANT_B });
    await sectionRepo.delete({ tenant_id: TENANT_A });
    await sectionRepo.delete({ tenant_id: TENANT_B });
    await classRepo.delete({ tenant_id: TENANT_A });
    await classRepo.delete({ tenant_id: TENANT_B });
    await yearRepo.delete({ tenant_id: TENANT_A });
    await yearRepo.delete({ tenant_id: TENANT_B });
    await schoolRepo.delete({ id: TENANT_A });
    await schoolRepo.delete({ id: TENANT_B });

    await schoolRepo.save(
      schoolRepo.create({ id: TENANT_A, name: 'Tenant A School', slug: 'tenant-a-academics' }),
    );
    await schoolRepo.save(
      schoolRepo.create({ id: TENANT_B, name: 'Tenant B School', slug: 'tenant-b-academics' }),
    );
  });

  describe('academic_years', () => {
    function rowFor(overrides: Partial<AcademicYearRow> = {}): AcademicYearRow {
      return {
        id: '00000000-0000-4000-8000-000000000001',
        name: '2026-2027',
        start_date: '2026-01-01',
        end_date: '2026-12-31',
        is_current: true,
        ...overrides,
      };
    }

    it('upsert creates a new row', async () => {
      const created = await academicYearsTab.upsert(rowFor(), null, TENANT_A, dataSource.manager);

      const saved = await yearRepo.findOneByOrFail({ id: created.id });
      expect(saved.name).toBe('2026-2027');
      expect(saved.tenant_id).toBe(TENANT_A);
    });

    it('upsert with one changed field updates only that field', async () => {
      const existing = await academicYearsTab.upsert(rowFor(), null, TENANT_A, dataSource.manager);

      await academicYearsTab.upsert(
        rowFor({ id: existing.id, name: '2027-2028' }),
        existing,
        TENANT_A,
        dataSource.manager,
      );

      const updated = await yearRepo.findOneByOrFail({ id: existing.id });
      expect(updated.name).toBe('2027-2028');
      expect(String(updated.start_date).slice(0, 10)).toBe('2026-01-01');
      expect(String(updated.end_date).slice(0, 10)).toBe('2026-12-31');
    });

    it('clears the previous current year in the same tenant when a new one is marked current', async () => {
      const first = await academicYearsTab.upsert(rowFor(), null, TENANT_A, dataSource.manager);
      expect(first.is_current).toBe(true);

      const second = await academicYearsTab.upsert(
        rowFor({ id: '00000000-0000-4000-8000-000000000002', name: '2027-2028' }),
        null,
        TENANT_A,
        dataSource.manager,
      );

      const refreshedFirst = await yearRepo.findOneByOrFail({ id: first.id });
      expect(refreshedFirst.is_current).toBe(false);
      expect(second.is_current).toBe(true);
    });

    it("does not clear another tenant's current year", async () => {
      const tenantBYear = await academicYearsTab.upsert(
        rowFor({ id: '00000000-0000-4000-8000-000000000003' }),
        null,
        TENANT_B,
        dataSource.manager,
      );

      await academicYearsTab.upsert(rowFor(), null, TENANT_A, dataSource.manager);

      const refreshed = await yearRepo.findOneByOrFail({ id: tenantBYear.id });
      expect(refreshed.is_current).toBe(true);
    });

    it('remove soft-deletes the year', async () => {
      const existing = await academicYearsTab.upsert(rowFor(), null, TENANT_A, dataSource.manager);

      await academicYearsTab.remove(existing, dataSource.manager);

      expect(await yearRepo.findOneBy({ id: existing.id })).toBeNull();
      const withDeleted = await yearRepo.findOne({
        where: { id: existing.id },
        withDeleted: true,
      });
      expect(withDeleted?.deleted_at).not.toBeNull();
    });

    it("load never returns another tenant's rows", async () => {
      await academicYearsTab.upsert(rowFor(), null, TENANT_A, dataSource.manager);
      await academicYearsTab.upsert(
        rowFor({ id: '00000000-0000-4000-8000-000000000004' }),
        null,
        TENANT_B,
        dataSource.manager,
      );

      const loaded = await academicYearsTab.load(TENANT_A, dataSource.manager);

      expect(loaded).toHaveLength(1);
      expect(loaded[0].tenant_id).toBe(TENANT_A);
    });
  });

  describe('classes', () => {
    async function seedYear(tenantId: string, id: string): Promise<AcademicYear> {
      return academicYearsTab.upsert(
        {
          id,
          name: '2026-2027',
          start_date: '2026-01-01',
          end_date: '2026-12-31',
          is_current: true,
        },
        null,
        tenantId,
        dataSource.manager,
      );
    }

    function rowFor(academicYearId: string, overrides: Partial<ClassRow> = {}): ClassRow {
      return {
        id: '00000000-0000-4000-8000-000000000010',
        name: 'Class 10',
        academic_year_id: academicYearId,
        academic_year_key: 'unused-in-upsert',
        ...overrides,
      };
    }

    it('upsert creates a new row', async () => {
      const year = await seedYear(TENANT_A, '00000000-0000-4000-8000-000000000020');

      const created = await classesTab.upsert(rowFor(year.id), null, TENANT_A, dataSource.manager);

      const saved = await classRepo.findOneByOrFail({ id: created.id });
      expect(saved.name).toBe('Class 10');
      expect(saved.academic_year_id).toBe(year.id);
      expect(saved.tenant_id).toBe(TENANT_A);
    });

    it('upsert with one changed field updates only that field', async () => {
      const year = await seedYear(TENANT_A, '00000000-0000-4000-8000-000000000021');
      const existing = await classesTab.upsert(rowFor(year.id), null, TENANT_A, dataSource.manager);

      await classesTab.upsert(
        rowFor(year.id, { id: existing.id, name: 'Class 10A' }),
        existing,
        TENANT_A,
        dataSource.manager,
      );

      const updated = await classRepo.findOneByOrFail({ id: existing.id });
      expect(updated.name).toBe('Class 10A');
      expect(updated.academic_year_id).toBe(year.id);
    });

    it('remove soft-deletes the class', async () => {
      const year = await seedYear(TENANT_A, '00000000-0000-4000-8000-000000000022');
      const existing = await classesTab.upsert(rowFor(year.id), null, TENANT_A, dataSource.manager);

      await classesTab.remove(existing, dataSource.manager);

      expect(await classRepo.findOneBy({ id: existing.id })).toBeNull();
      const withDeleted = await classRepo.findOne({
        where: { id: existing.id },
        withDeleted: true,
      });
      expect(withDeleted?.deleted_at).not.toBeNull();
    });

    it("load never returns another tenant's rows", async () => {
      const yearA = await seedYear(TENANT_A, '00000000-0000-4000-8000-000000000023');
      const yearB = await seedYear(TENANT_B, '00000000-0000-4000-8000-000000000024');
      await classesTab.upsert(rowFor(yearA.id), null, TENANT_A, dataSource.manager);
      await classesTab.upsert(
        rowFor(yearB.id, { id: '00000000-0000-4000-8000-000000000025' }),
        null,
        TENANT_B,
        dataSource.manager,
      );

      const loaded = await classesTab.load(TENANT_A, dataSource.manager);

      expect(loaded).toHaveLength(1);
      expect(loaded[0].tenant_id).toBe(TENANT_A);
    });
  });

  describe('sections', () => {
    async function seedClass(tenantId: string, id: string): Promise<Class> {
      const year = await academicYearsTab.upsert(
        {
          id: `${id}-year`.slice(0, 36).padEnd(36, '0'),
          name: `Year for ${id}`,
          start_date: '2026-01-01',
          end_date: '2026-12-31',
          is_current: true,
        },
        null,
        tenantId,
        dataSource.manager,
      );

      return classesTab.upsert(
        { id, name: 'Class 10', academic_year_id: year.id, academic_year_key: 'unused-in-upsert' },
        null,
        tenantId,
        dataSource.manager,
      );
    }

    function rowFor(klass: Class, overrides: Partial<ClassSectionRow> = {}): ClassSectionRow {
      return {
        id: '00000000-0000-4000-8000-000000000030',
        class_id: klass.id,
        academic_year_id: klass.academic_year_id,
        section_name: 'A',
        capacity: 40,
        class_key: 'unused-in-upsert',
        academic_year_key: 'unused-in-upsert',
        ...overrides,
      };
    }

    it('upsert creates a new row', async () => {
      const klass = await seedClass(TENANT_A, '00000000-0000-4000-8000-000000000040');

      const created = await sectionsTab.upsert(rowFor(klass), null, TENANT_A, dataSource.manager);

      const saved = await sectionRepo.findOneByOrFail({ id: created.id });
      expect(saved.section_name).toBe('A');
      expect(saved.capacity).toBe(40);
      expect(saved.class_id).toBe(klass.id);
      expect(saved.tenant_id).toBe(TENANT_A);
    });

    it('upsert with one changed field updates only that field', async () => {
      const klass = await seedClass(TENANT_A, '00000000-0000-4000-8000-000000000041');
      const existing = await sectionsTab.upsert(rowFor(klass), null, TENANT_A, dataSource.manager);

      await sectionsTab.upsert(
        rowFor(klass, { id: existing.id, capacity: 45 }),
        existing,
        TENANT_A,
        dataSource.manager,
      );

      const updated = await sectionRepo.findOneByOrFail({ id: existing.id });
      expect(updated.capacity).toBe(45);
      expect(updated.section_name).toBe('A');
    });

    it('remove soft-deletes the section', async () => {
      const klass = await seedClass(TENANT_A, '00000000-0000-4000-8000-000000000042');
      const existing = await sectionsTab.upsert(rowFor(klass), null, TENANT_A, dataSource.manager);

      await sectionsTab.remove(existing, dataSource.manager);

      expect(await sectionRepo.findOneBy({ id: existing.id })).toBeNull();
      const withDeleted = await sectionRepo.findOne({
        where: { id: existing.id },
        withDeleted: true,
      });
      expect(withDeleted?.deleted_at).not.toBeNull();
    });

    it("load never returns another tenant's rows", async () => {
      const classA = await seedClass(TENANT_A, '00000000-0000-4000-8000-000000000043');
      const classB = await seedClass(TENANT_B, '00000000-0000-4000-8000-000000000044');
      await sectionsTab.upsert(rowFor(classA), null, TENANT_A, dataSource.manager);
      await sectionsTab.upsert(
        rowFor(classB, { id: '00000000-0000-4000-8000-000000000045' }),
        null,
        TENANT_B,
        dataSource.manager,
      );

      const loaded = await sectionsTab.load(TENANT_A, dataSource.manager);

      expect(loaded).toHaveLength(1);
      expect(loaded[0].tenant_id).toBe(TENANT_A);
      // `load` eagerly joins `class` for the `academic_year` ref export.
      expect(loaded[0].class?.id).toBe(classA.id);
    });
  });

  describe('subjects', () => {
    function rowFor(overrides: Partial<SubjectRow> = {}): SubjectRow {
      return {
        id: '00000000-0000-4000-8000-000000000050',
        code: 'MATH',
        name_en: 'Mathematics',
        name_bn: 'গণিত',
        is_active: true,
        ...overrides,
      };
    }

    it('upsert creates a new row', async () => {
      const created = await subjectsTab.upsert(rowFor(), null, TENANT_A, dataSource.manager);

      const saved = await subjectRepo.findOneByOrFail({ id: created.id });
      expect(saved.code).toBe('MATH');
      expect(saved.tenant_id).toBe(TENANT_A);
    });

    it('upsert with one changed field updates only that field', async () => {
      const existing = await subjectsTab.upsert(rowFor(), null, TENANT_A, dataSource.manager);

      await subjectsTab.upsert(
        rowFor({ id: existing.id, name_en: 'Advanced Mathematics' }),
        existing,
        TENANT_A,
        dataSource.manager,
      );

      const updated = await subjectRepo.findOneByOrFail({ id: existing.id });
      expect(updated.name_en).toBe('Advanced Mathematics');
      expect(updated.code).toBe('MATH');
    });

    it('remove soft-deletes the subject', async () => {
      const existing = await subjectsTab.upsert(rowFor(), null, TENANT_A, dataSource.manager);

      await subjectsTab.remove(existing, dataSource.manager);

      expect(await subjectRepo.findOneBy({ id: existing.id })).toBeNull();
      const withDeleted = await subjectRepo.findOne({
        where: { id: existing.id },
        withDeleted: true,
      });
      expect(withDeleted?.deleted_at).not.toBeNull();
    });

    it("load never returns another tenant's rows", async () => {
      await subjectsTab.upsert(rowFor(), null, TENANT_A, dataSource.manager);
      await subjectsTab.upsert(
        rowFor({ id: '00000000-0000-4000-8000-000000000051' }),
        null,
        TENANT_B,
        dataSource.manager,
      );

      const loaded = await subjectsTab.load(TENANT_A, dataSource.manager);

      expect(loaded).toHaveLength(1);
      expect(loaded[0].tenant_id).toBe(TENANT_A);
    });
  });

  describe('class_subjects', () => {
    async function seedClassAndSubject(
      tenantId: string,
      id: string,
    ): Promise<{ klass: Class; subject: Subject }> {
      const year = await academicYearsTab.upsert(
        {
          id: `${id}-year`.slice(0, 36).padEnd(36, '0'),
          name: `Year for ${id}`,
          start_date: '2026-01-01',
          end_date: '2026-12-31',
          is_current: true,
        },
        null,
        tenantId,
        dataSource.manager,
      );

      const klass = await classesTab.upsert(
        { id, name: 'Class 10', academic_year_id: year.id, academic_year_key: 'unused-in-upsert' },
        null,
        tenantId,
        dataSource.manager,
      );

      const subject = await subjectsTab.upsert(
        {
          id: `${id}-subj`.slice(0, 36).padEnd(36, '0'),
          code: 'MATH',
          name_en: 'Mathematics',
          name_bn: null,
          is_active: true,
        },
        null,
        tenantId,
        dataSource.manager,
      );

      return { klass, subject };
    }

    function rowFor(
      klass: Class,
      subject: Subject,
      overrides: Partial<ClassSubjectRow> = {},
    ): ClassSubjectRow {
      return {
        id: '00000000-0000-4000-8000-000000000060',
        class_id: klass.id,
        academic_year_id: klass.academic_year_id,
        subject_id: subject.id,
        is_optional: false,
        class_key: 'unused-in-upsert',
        academic_year_key: 'unused-in-upsert',
        subject_key: 'unused-in-upsert',
        ...overrides,
      };
    }

    it('upsert creates a new row', async () => {
      const { klass, subject } = await seedClassAndSubject(
        TENANT_A,
        '00000000-0000-4000-8000-000000000070',
      );

      const created = await classSubjectsTab.upsert(
        rowFor(klass, subject),
        null,
        TENANT_A,
        dataSource.manager,
      );

      const saved = await classSubjectRepo.findOneByOrFail({ id: created.id });
      expect(saved.class_id).toBe(klass.id);
      expect(saved.subject_id).toBe(subject.id);
      expect(saved.is_optional).toBe(false);
      expect(saved.tenant_id).toBe(TENANT_A);
    });

    it('upsert with one changed field updates only that field', async () => {
      const { klass, subject } = await seedClassAndSubject(
        TENANT_A,
        '00000000-0000-4000-8000-000000000071',
      );
      const existing = await classSubjectsTab.upsert(
        rowFor(klass, subject),
        null,
        TENANT_A,
        dataSource.manager,
      );

      await classSubjectsTab.upsert(
        rowFor(klass, subject, { id: existing.id, is_optional: true }),
        existing,
        TENANT_A,
        dataSource.manager,
      );

      const updated = await classSubjectRepo.findOneByOrFail({ id: existing.id });
      expect(updated.is_optional).toBe(true);
      expect(updated.class_id).toBe(klass.id);
    });

    it('remove soft-deletes the class_subject', async () => {
      const { klass, subject } = await seedClassAndSubject(
        TENANT_A,
        '00000000-0000-4000-8000-000000000072',
      );
      const existing = await classSubjectsTab.upsert(
        rowFor(klass, subject),
        null,
        TENANT_A,
        dataSource.manager,
      );

      await classSubjectsTab.remove(existing, dataSource.manager);

      expect(await classSubjectRepo.findOneBy({ id: existing.id })).toBeNull();
      const withDeleted = await classSubjectRepo.findOne({
        where: { id: existing.id },
        withDeleted: true,
      });
      expect(withDeleted?.deleted_at).not.toBeNull();
    });

    it("load never returns another tenant's rows", async () => {
      const a = await seedClassAndSubject(TENANT_A, '00000000-0000-4000-8000-000000000073');
      const b = await seedClassAndSubject(TENANT_B, '00000000-0000-4000-8000-000000000074');
      await classSubjectsTab.upsert(rowFor(a.klass, a.subject), null, TENANT_A, dataSource.manager);
      await classSubjectsTab.upsert(
        rowFor(b.klass, b.subject, { id: '00000000-0000-4000-8000-000000000075' }),
        null,
        TENANT_B,
        dataSource.manager,
      );

      const loaded = await classSubjectsTab.load(TENANT_A, dataSource.manager);

      expect(loaded).toHaveLength(1);
      expect(loaded[0].tenant_id).toBe(TENANT_A);
      // `load` eagerly joins `class`, `class.academic_year`, `subject`, and
      // `academic_year` for `keyOf`'s natural-key text.
      expect(loaded[0].class?.id).toBe(a.klass.id);
      expect(loaded[0].subject?.id).toBe(a.subject.id);
    });
  });

  describe('holidays', () => {
    async function seedYear(tenantId: string, id: string): Promise<AcademicYear> {
      return academicYearsTab.upsert(
        {
          id,
          name: '2026-2027',
          start_date: '2026-01-01',
          end_date: '2026-12-31',
          is_current: true,
        },
        null,
        tenantId,
        dataSource.manager,
      );
    }

    function rowFor(academicYearId: string, overrides: Partial<HolidayRow> = {}): HolidayRow {
      return {
        id: '00000000-0000-4000-8000-000000000080',
        academic_year_id: academicYearId,
        name: 'Winter break',
        start_date: '2026-12-20',
        end_date: '2026-12-31',
        counts_as_working_day: false,
        academic_year_key: 'unused-in-upsert',
        ...overrides,
      };
    }

    it('upsert creates a new row', async () => {
      const year = await seedYear(TENANT_A, '00000000-0000-4000-8000-000000000090');

      const created = await holidaysTab.upsert(rowFor(year.id), null, TENANT_A, dataSource.manager);

      const saved = await holidayRepo.findOneByOrFail({ id: created.id });
      expect(saved.name).toBe('Winter break');
      expect(saved.academic_year_id).toBe(year.id);
      expect(saved.tenant_id).toBe(TENANT_A);
    });

    it('upsert with one changed field updates only that field', async () => {
      const year = await seedYear(TENANT_A, '00000000-0000-4000-8000-000000000091');
      const existing = await holidaysTab.upsert(
        rowFor(year.id),
        null,
        TENANT_A,
        dataSource.manager,
      );

      await holidaysTab.upsert(
        rowFor(year.id, { id: existing.id, counts_as_working_day: true }),
        existing,
        TENANT_A,
        dataSource.manager,
      );

      const updated = await holidayRepo.findOneByOrFail({ id: existing.id });
      expect(updated.counts_as_working_day).toBe(true);
      expect(updated.name).toBe('Winter break');
    });

    it('remove soft-deletes the holiday', async () => {
      const year = await seedYear(TENANT_A, '00000000-0000-4000-8000-000000000092');
      const existing = await holidaysTab.upsert(
        rowFor(year.id),
        null,
        TENANT_A,
        dataSource.manager,
      );

      await holidaysTab.remove(existing, dataSource.manager);

      expect(await holidayRepo.findOneBy({ id: existing.id })).toBeNull();
      const withDeleted = await holidayRepo.findOne({
        where: { id: existing.id },
        withDeleted: true,
      });
      expect(withDeleted?.deleted_at).not.toBeNull();
    });

    it("load never returns another tenant's rows", async () => {
      const yearA = await seedYear(TENANT_A, '00000000-0000-4000-8000-000000000093');
      const yearB = await seedYear(TENANT_B, '00000000-0000-4000-8000-000000000094');
      await holidaysTab.upsert(rowFor(yearA.id), null, TENANT_A, dataSource.manager);
      await holidaysTab.upsert(
        rowFor(yearB.id, { id: '00000000-0000-4000-8000-000000000095' }),
        null,
        TENANT_B,
        dataSource.manager,
      );

      const loaded = await holidaysTab.load(TENANT_A, dataSource.manager);

      expect(loaded).toHaveLength(1);
      expect(loaded[0].tenant_id).toBe(TENANT_A);
    });
  });
});
