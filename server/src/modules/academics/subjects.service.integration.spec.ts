import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { SubjectService } from './subjects.service';
import { School } from '../schools/entities/school.entity';
import { AcademicYear } from './entities/academic-year.entity';
import { Class } from './entities/class.entity';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';

/**
 * Integration tests for SubjectService — runs against a real Postgres
 * database. Covers CRUD, tenant isolation, duplicate-code handling, soft
 * delete, and attaching a subject from another tenant to a class.
 */
describe('SubjectService (integration)', () => {
  let service: SubjectService;
  let dataSource: DataSource;

  const TENANT_ID = SEED_TENANT_ID;
  const OTHER_TENANT = '00000000-0000-4000-8000-000000000099';

  let academicYearId: string;
  let classId: string;
  let otherTenantAcademicYearId: string;
  let otherTenantClassId: string;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [SubjectService], [], {
      synchronize: true,
      dropSchema: true,
    });

    service = module.get<SubjectService>(SubjectService);
    dataSource = module.get<DataSource>(getDataSourceToken());

    const schoolRepo = dataSource.getRepository(School);
    const existing = await schoolRepo.findOne({ where: { id: TENANT_ID } });
    if (!existing) {
      await schoolRepo.save({ id: TENANT_ID, name: 'Test School', slug: 'test-school' });
    }
    const otherExisting = await schoolRepo.findOne({ where: { id: OTHER_TENANT } });
    if (!otherExisting) {
      await schoolRepo.save({ id: OTHER_TENANT, name: 'Other School', slug: 'other-school' });
    }
  }, 60000);

  afterAll(async () => {
    if (dataSource) {
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM class_subjects');
    await dataSource.query('DELETE FROM subjects');
    await dataSource.query('DELETE FROM classes');
    await dataSource.query('DELETE FROM academic_years');

    const academicYearRepo = dataSource.getRepository(AcademicYear);
    const classRepo = dataSource.getRepository(Class);

    const academicYear = await academicYearRepo.save({
      name: '2026-2027',
      start_date: new Date('2026-01-01'),
      end_date: new Date('2026-12-31'),
      tenant_id: TENANT_ID,
    });
    academicYearId = academicYear.id;

    const klass = await classRepo.save({
      name: 'Class 6',
      academic_year_id: academicYearId,
      tenant_id: TENANT_ID,
    });
    classId = klass.id;

    const otherAcademicYear = await academicYearRepo.save({
      name: '2026-2027',
      start_date: new Date('2026-01-01'),
      end_date: new Date('2026-12-31'),
      tenant_id: OTHER_TENANT,
    });
    otherTenantAcademicYearId = otherAcademicYear.id;

    const otherClass = await classRepo.save({
      name: 'Class 6',
      academic_year_id: otherTenantAcademicYearId,
      tenant_id: OTHER_TENANT,
    });
    otherTenantClassId = otherClass.id;
  });

  describe('create', () => {
    it('creates a subject', async () => {
      const result = await service.create({ name_en: 'Mathematics', code: 'MATH' }, TENANT_ID);

      expect(result).toBeDefined();
      expect(result.name_en).toBe('Mathematics');
      expect(result.code).toBe('MATH');
      expect(result.tenant_id).toBe(TENANT_ID);
      expect(result.is_active).toBe(true);
    });

    it('rejects a duplicate code within the same tenant', async () => {
      await service.create({ name_en: 'Mathematics', code: 'MATH' }, TENANT_ID);

      await expect(
        service.create({ name_en: 'Advanced Math', code: 'MATH' }, TENANT_ID),
      ).rejects.toThrow(ConflictException);
    });

    it('allows the same code in two different tenants', async () => {
      await service.create({ name_en: 'Mathematics', code: 'MATH' }, TENANT_ID);

      const result = await service.create({ name_en: 'Mathematics', code: 'MATH' }, OTHER_TENANT);

      expect(result.tenant_id).toBe(OTHER_TENANT);
    });
  });

  describe('findAll / findOne / tenant isolation', () => {
    it("cannot read another tenant's subject", async () => {
      const created = await service.create({ name_en: 'Mathematics', code: 'MATH' }, OTHER_TENANT);

      await expect(service.findOne(created.id, TENANT_ID)).rejects.toThrow(NotFoundException);
    });

    it('excludes soft-deleted subjects from findAll', async () => {
      const created = await service.create({ name_en: 'Mathematics', code: 'MATH' }, TENANT_ID);
      await service.remove(created.id, TENANT_ID);

      const result = await service.findAll({ page: 1, limit: 10 }, TENANT_ID);
      expect(result.data).toHaveLength(0);
    });
  });

  describe('update', () => {
    it("cannot update another tenant's subject", async () => {
      const created = await service.create({ name_en: 'Mathematics', code: 'MATH' }, OTHER_TENANT);

      await expect(service.update(created.id, { name_en: 'Changed' }, TENANT_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('soft-deletes and sets deleted_at', async () => {
      const created = await service.create({ name_en: 'Mathematics', code: 'MATH' }, TENANT_ID);
      await service.remove(created.id, TENANT_ID);

      const raw = await dataSource.query('SELECT deleted_at FROM subjects WHERE id = $1', [
        created.id,
      ]);
      expect(raw[0].deleted_at).not.toBeNull();
    });

    it("cannot delete another tenant's subject", async () => {
      const created = await service.create({ name_en: 'Mathematics', code: 'MATH' }, OTHER_TENANT);

      await expect(service.remove(created.id, TENANT_ID)).rejects.toThrow(NotFoundException);
    });
  });

  describe('attachToClass / findByClass / detachFromClass', () => {
    it('attaches a subject to a class and lists it', async () => {
      const subject = await service.create({ name_en: 'Mathematics', code: 'MATH' }, TENANT_ID);

      await service.attachToClass(
        classId,
        { subject_id: subject.id, academic_year_id: academicYearId },
        TENANT_ID,
      );

      const result = await service.findByClass(classId, academicYearId, TENANT_ID);
      expect(result).toHaveLength(1);
      expect(result[0].subject_id).toBe(subject.id);
      expect(result[0].subject.name_en).toBe('Mathematics');
    });

    it('rejects attaching a subject from another tenant to a class', async () => {
      const otherSubject = await service.create(
        { name_en: 'Mathematics', code: 'MATH' },
        OTHER_TENANT,
      );

      await expect(
        service.attachToClass(
          classId,
          { subject_id: otherSubject.id, academic_year_id: academicYearId },
          TENANT_ID,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects attaching to a class from another tenant', async () => {
      const subject = await service.create({ name_en: 'Mathematics', code: 'MATH' }, TENANT_ID);

      await expect(
        service.attachToClass(
          otherTenantClassId,
          { subject_id: subject.id, academic_year_id: academicYearId },
          TENANT_ID,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a duplicate (class, subject, academic year) attachment', async () => {
      const subject = await service.create({ name_en: 'Mathematics', code: 'MATH' }, TENANT_ID);
      await service.attachToClass(
        classId,
        { subject_id: subject.id, academic_year_id: academicYearId },
        TENANT_ID,
      );

      await expect(
        service.attachToClass(
          classId,
          { subject_id: subject.id, academic_year_id: academicYearId },
          TENANT_ID,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('detaches a subject from a class', async () => {
      const subject = await service.create({ name_en: 'Mathematics', code: 'MATH' }, TENANT_ID);
      await service.attachToClass(
        classId,
        { subject_id: subject.id, academic_year_id: academicYearId },
        TENANT_ID,
      );

      await service.detachFromClass(classId, subject.id, academicYearId, TENANT_ID);

      const result = await service.findByClass(classId, academicYearId, TENANT_ID);
      expect(result).toHaveLength(0);
    });

    it('throws NotFoundException detaching a subject not attached to the class', async () => {
      const subject = await service.create({ name_en: 'Mathematics', code: 'MATH' }, TENANT_ID);

      await expect(
        service.detachFromClass(classId, subject.id, academicYearId, TENANT_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
