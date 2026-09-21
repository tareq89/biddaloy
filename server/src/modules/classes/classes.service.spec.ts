import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClassService, SectionService } from './classes.service';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Teacher } from '../academics/entities/teacher.entity';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { Student } from '../students/entities/student.entity';
import { AuditService } from '../audit/audit.service';
import { SchoolSettingsReader } from '../schools/settings/school-settings-reader.service';

/**
 * Unit tests for [33.2.1]'s shift/version/group write-validation in
 * `ClassService`/`SectionService` — asserting on/against the tenant's
 * `TenantSettings.organisation` vocabulary. DB-level uniqueness (the
 * `NULLS NOT DISTINCT` index) is covered by
 * `classes.service.integration.spec.ts` instead, since it's a real
 * Postgres constraint, not something worth mocking.
 */

const TENANT_ID = 'tenant-1';

/** A repo stub whose `manager.transaction` just runs the callback against
 * itself — `create`/`update` in `classes.service.ts` build the entity
 * inside `repo.manager.transaction`, so the callback needs a working
 * `getRepository` too. */
function createRepoStub() {
  const repo: any = {
    create: vi.fn((v: any) => v),
    save: vi.fn(async (v: any) => ({ id: 'new-id', ...v })),
    update: vi.fn(async () => undefined),
    findOne: vi.fn(async () => null),
  };
  repo.manager = {
    transaction: vi.fn(async (cb: any) => cb({ getRepository: () => repo })),
  };
  return repo;
}

async function buildClassService(vocabulary: { shifts: string[]; versions: string[] }) {
  const classRepo = createRepoStub();
  const auditService = { record: vi.fn(async () => undefined) };
  const settingsReader = {
    organisationVocabulary: vi.fn(async () => ({ groups: [], ...vocabulary })),
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      ClassService,
      { provide: getRepositoryToken(Class), useValue: classRepo },
      { provide: getRepositoryToken(ClassSection), useValue: {} },
      { provide: getRepositoryToken(Student), useValue: {} },
      { provide: AuditService, useValue: auditService },
      { provide: SchoolSettingsReader, useValue: settingsReader },
    ],
  }).compile();

  return { service: moduleRef.get(ClassService), classRepo, settingsReader };
}

async function buildSectionService(vocabulary: { groups: string[] }, existingSection: any = {}) {
  const sectionRepo = createRepoStub();
  sectionRepo.findOne = vi.fn(async () => existingSection);
  const classRepo = { findOne: vi.fn(async () => ({ id: 'class-1' })) };
  const auditService = { record: vi.fn(async () => undefined) };
  const settingsReader = {
    organisationVocabulary: vi.fn(async () => ({ shifts: [], versions: [], ...vocabulary })),
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      SectionService,
      { provide: getRepositoryToken(ClassSection), useValue: sectionRepo },
      { provide: getRepositoryToken(Class), useValue: classRepo },
      { provide: getRepositoryToken(Student), useValue: {} },
      { provide: getRepositoryToken(TeacherClassSection), useValue: {} },
      { provide: AuditService, useValue: auditService },
      { provide: SchoolSettingsReader, useValue: settingsReader },
    ],
  }).compile();

  return { service: moduleRef.get(SectionService), sectionRepo, settingsReader };
}

describe('ClassService.organisationVocabulary [33.4.1]', () => {
  it('delegates straight to SchoolSettingsReader for the given tenant', async () => {
    const { service, settingsReader } = await buildClassService({
      shifts: ['Morning', 'Day'],
      versions: ['Bangla'],
    });
    const result = await service.organisationVocabulary(TENANT_ID);
    expect(result).toEqual({ groups: [], shifts: ['Morning', 'Day'], versions: ['Bangla'] });
    expect(settingsReader.organisationVocabulary).toHaveBeenCalledWith(TENANT_ID);
  });
});

describe('ClassService shift/version vocabulary [33.2.1]', () => {
  it('accepts a value present in the vocabulary', async () => {
    const { service } = await buildClassService({ shifts: ['Morning', 'Day'], versions: [] });

    await expect(
      service.create({ name: 'C', academic_year_id: 'y', shift: 'Morning' } as any, TENANT_ID),
    ).resolves.toMatchObject({ shift: 'Morning' });
  });

  it('rejects a value not in the vocabulary', async () => {
    const { service } = await buildClassService({ shifts: ['Morning', 'Day'], versions: [] });

    await expect(
      service.create({ name: 'C', academic_year_id: 'y', shift: 'Evening' } as any, TENANT_ID),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts null with an empty vocabulary', async () => {
    const { service } = await buildClassService({ shifts: [], versions: [] });

    await expect(
      service.create({ name: 'C', academic_year_id: 'y', shift: null } as any, TENANT_ID),
    ).resolves.toMatchObject({ shift: null });
  });

  it('accepts null with a populated vocabulary', async () => {
    const { service } = await buildClassService({ shifts: ['Morning', 'Day'], versions: [] });

    await expect(
      service.create({ name: 'C', academic_year_id: 'y', shift: null } as any, TENANT_ID),
    ).resolves.toMatchObject({ shift: null });
  });

  it('rejects an out-of-vocabulary value on update, before writing', async () => {
    const { service, classRepo } = await buildClassService({ shifts: ['Morning'], versions: [] });
    classRepo.findOne = vi.fn(async () => ({ id: 'c1', tenant_id: TENANT_ID, shift: 'Morning' }));

    await expect(service.update('c1', { shift: 'Evening' } as any, TENANT_ID)).rejects.toThrow(
      BadRequestException,
    );
    expect(classRepo.update).not.toHaveBeenCalled();
  });

  it(
    'rejects a non-null value when the vocabulary is empty — an empty vocabulary means ' +
      '"nothing configured yet", not "anything goes"',
    async () => {
      const { service } = await buildClassService({ shifts: [], versions: [] });

      await expect(
        service.create({ name: 'C', academic_year_id: 'y', shift: 'Morning' } as any, TENANT_ID),
      ).rejects.toThrow(BadRequestException);
    },
  );
});

describe('SectionService group vocabulary [33.2.1]', () => {
  it('accepts a value present in the vocabulary', async () => {
    const { service } = await buildSectionService({ groups: ['Science', 'Commerce'] });

    await expect(
      service.create('class-1', { section_name: 'A', group_name: 'Science' } as any, TENANT_ID),
    ).resolves.toMatchObject({ group_name: 'Science' });
  });

  it('rejects a value not in the vocabulary', async () => {
    const { service } = await buildSectionService({ groups: ['Science', 'Commerce'] });

    await expect(
      service.create('class-1', { section_name: 'A', group_name: 'Arts' } as any, TENANT_ID),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts null with an empty vocabulary', async () => {
    const { service } = await buildSectionService({ groups: [] });

    await expect(
      service.create('class-1', { section_name: 'A', group_name: null } as any, TENANT_ID),
    ).resolves.toMatchObject({ group_name: null });
  });

  it('accepts null with a populated vocabulary', async () => {
    const { service } = await buildSectionService({ groups: ['Science'] });

    await expect(
      service.create('class-1', { section_name: 'A', group_name: null } as any, TENANT_ID),
    ).resolves.toMatchObject({ group_name: null });
  });

  it('rejects an out-of-vocabulary value on update, before writing', async () => {
    const { service, sectionRepo } = await buildSectionService(
      { groups: ['Science'] },
      { id: 's1', class_id: 'class-1', tenant_id: TENANT_ID, group_name: 'Science' },
    );

    await expect(
      service.update('class-1', 's1', { group_name: 'Arts' } as any, TENANT_ID),
    ).rejects.toThrow(BadRequestException);
    expect(sectionRepo.update).not.toHaveBeenCalled();
  });

  it(
    'rejects a non-null value when the vocabulary is empty — an empty vocabulary means ' +
      '"nothing configured yet", not "anything goes"',
    async () => {
      const { service } = await buildSectionService({ groups: [] });

      await expect(
        service.create('class-1', { section_name: 'A', group_name: 'Science' } as any, TENANT_ID),
      ).rejects.toThrow(BadRequestException);
    },
  );

  it('throws NotFoundException, not a vocabulary error, when the section does not exist', async () => {
    const { service } = await buildSectionService({ groups: ['Science'] }, null);

    await expect(
      service.update('class-1', 'missing', { group_name: 'Arts' } as any, TENANT_ID),
    ).rejects.toThrow(NotFoundException);
  });
});
