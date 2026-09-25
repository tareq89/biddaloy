import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IsNull } from 'typeorm';
import { ClassService, SectionService } from './classes.service';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Teacher } from '../academics/entities/teacher.entity';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { Subject } from '../academics/entities/subject.entity';
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
      { provide: getRepositoryToken(Teacher), useValue: {} },
      { provide: getRepositoryToken(TeacherClassSection), useValue: {} },
      { provide: getRepositoryToken(Subject), useValue: {} },
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

/** [29.0] `SectionService.assignTeacher`/`unassignTeacher`/
 * `listSectionTeachers` — D3 (auto-replace class-teacher), D8 (explicit
 * conflict check ahead of insert). */
async function buildTeacherAssignmentService(opts: {
  section?: any;
  teacher?: any;
  subject?: any;
  existingClassTeacherRow?: any;
  duplicateSubjectRow?: any;
  assignment?: any;
}) {
  const sectionRepo: any = {
    findOne: vi.fn(async () =>
      opts.section === undefined ? { id: 's1', class_id: 'c1' } : opts.section,
    ),
  };
  const classRepo: any = { findOne: vi.fn(async () => ({ id: 'c1' })) };
  const teacherRepo: any = {
    findOne: vi.fn(async () => (opts.teacher === undefined ? { id: 't1' } : opts.teacher)),
  };
  const subjectRepo: any = {
    findOne: vi.fn(async () => (opts.subject === undefined ? { id: 'subj-1' } : opts.subject)),
  };
  const tcsRepo: any = {
    findOne: vi.fn(async () =>
      opts.assignment !== undefined
        ? opts.assignment
        : (opts.duplicateSubjectRow ?? opts.existingClassTeacherRow ?? null),
    ),
    delete: vi.fn(async () => undefined),
    create: vi.fn((v: any) => v),
    save: vi.fn(async (v: any) => ({ id: 'assignment-1', ...v })),
  };
  tcsRepo.manager = { transaction: vi.fn(async (cb: any) => cb({ getRepository: () => tcsRepo })) };
  const auditService = { record: vi.fn(async () => undefined) };
  const settingsReader = { organisationVocabulary: vi.fn(async () => ({ groups: [] })) };

  const moduleRef = await Test.createTestingModule({
    providers: [
      SectionService,
      { provide: getRepositoryToken(ClassSection), useValue: sectionRepo },
      { provide: getRepositoryToken(Class), useValue: classRepo },
      { provide: getRepositoryToken(Student), useValue: {} },
      { provide: getRepositoryToken(Teacher), useValue: teacherRepo },
      { provide: getRepositoryToken(TeacherClassSection), useValue: tcsRepo },
      { provide: getRepositoryToken(Subject), useValue: subjectRepo },
      { provide: AuditService, useValue: auditService },
      { provide: SchoolSettingsReader, useValue: settingsReader },
    ],
  }).compile();

  return {
    service: moduleRef.get(SectionService),
    sectionRepo,
    teacherRepo,
    subjectRepo,
    tcsRepo,
    auditService,
  };
}

describe('SectionService.assignTeacher [29.0]', () => {
  it('assigns a class-teacher (subject_id omitted)', async () => {
    const { service, tcsRepo, auditService } = await buildTeacherAssignmentService({});

    const result = await service.assignTeacher('c1', 's1', { teacher_id: 't1' } as any, TENANT_ID);

    expect(result).toMatchObject({ teacher_id: 't1', section_id: 's1', subject_id: null });
    // No prior class-teacher row for this section, so nothing to delete/audit.
    expect(tcsRepo.delete).not.toHaveBeenCalled();
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATE', entity_type: 'TeacherClassSection' }),
      expect.anything(),
    );
  });

  it('D3 — deletes and audit-logs any existing class-teacher row for this section before inserting the new one', async () => {
    const { service, tcsRepo, auditService } = await buildTeacherAssignmentService({
      existingClassTeacherRow: {
        id: 'old-ct',
        teacher_id: 't-old',
        section_id: 's1',
        subject_id: null,
      },
    });

    await service.assignTeacher('c1', 's1', { teacher_id: 't1' } as any, TENANT_ID);

    expect(tcsRepo.delete).toHaveBeenCalledWith({ id: 'old-ct' });
    expect(tcsRepo.save).toHaveBeenCalled();
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'DELETE',
        entity_type: 'TeacherClassSection',
        entity_id: 'old-ct',
      }),
      expect.anything(),
    );
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATE', entity_type: 'TeacherClassSection' }),
      expect.anything(),
    );
  });

  it('assigns a subject-teacher (subject_id set)', async () => {
    const { service } = await buildTeacherAssignmentService({});

    const result = await service.assignTeacher(
      'c1',
      's1',
      { teacher_id: 't1', subject_id: 'subj-1' } as any,
      TENANT_ID,
    );

    expect(result).toMatchObject({ teacher_id: 't1', section_id: 's1', subject_id: 'subj-1' });
  });

  it('D8 — 409s on a duplicate subject-teacher assignment, checked explicitly before insert', async () => {
    const { service, tcsRepo } = await buildTeacherAssignmentService({
      duplicateSubjectRow: {
        id: 'existing',
        teacher_id: 't1',
        section_id: 's1',
        subject_id: 'subj-1',
      },
    });

    await expect(
      service.assignTeacher(
        'c1',
        's1',
        { teacher_id: 't1', subject_id: 'subj-1' } as any,
        TENANT_ID,
      ),
    ).rejects.toThrow(ConflictException);
    expect(tcsRepo.save).not.toHaveBeenCalled();
  });

  it('404s assigning a section that does not resolve under this tenant', async () => {
    const { service } = await buildTeacherAssignmentService({ section: null });

    await expect(
      service.assignTeacher('c1', 's1', { teacher_id: 't1' } as any, TENANT_ID),
    ).rejects.toThrow(NotFoundException);
  });

  it('404s assigning a teacher that does not resolve under this tenant', async () => {
    const { service } = await buildTeacherAssignmentService({ teacher: null });

    await expect(
      service.assignTeacher('c1', 's1', { teacher_id: 't1' } as any, TENANT_ID),
    ).rejects.toThrow(NotFoundException);
  });

  it('404s assigning a subject that does not resolve under this tenant, before any write', async () => {
    const { service, subjectRepo, tcsRepo } = await buildTeacherAssignmentService({
      subject: null,
    });

    await expect(
      service.assignTeacher(
        'c1',
        's1',
        { teacher_id: 't1', subject_id: 'foreign-subj' } as any,
        TENANT_ID,
      ),
    ).rejects.toThrow(NotFoundException);
    expect(subjectRepo.findOne).toHaveBeenCalledWith({
      where: { id: 'foreign-subj', tenant_id: TENANT_ID, deleted_at: IsNull() },
    });
    expect(tcsRepo.save).not.toHaveBeenCalled();
  });
});

describe('SectionService.unassignTeacher [29.0]', () => {
  it('removes an assignment and audit-logs the delete', async () => {
    const { service, tcsRepo, auditService } = await buildTeacherAssignmentService({
      assignment: { id: 'a1', teacher_id: 't1', section_id: 's1', subject_id: null },
    });

    await service.unassignTeacher('c1', 's1', 'a1', TENANT_ID);

    expect(tcsRepo.delete).toHaveBeenCalledWith({
      id: 'a1',
      section_id: 's1',
      tenant_id: TENANT_ID,
    });
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DELETE', entity_type: 'TeacherClassSection' }),
      expect.anything(),
    );
  });

  it('404s on a non-existent assignment id', async () => {
    const { service } = await buildTeacherAssignmentService({ assignment: null });

    await expect(service.unassignTeacher('c1', 's1', 'missing', TENANT_ID)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('404s on an assignment belonging to a foreign tenant/section (scoped lookup finds nothing)', async () => {
    const { service, tcsRepo } = await buildTeacherAssignmentService({ assignment: null });

    await expect(service.unassignTeacher('c1', 's1', 'foreign-row', TENANT_ID)).rejects.toThrow(
      NotFoundException,
    );
    expect(tcsRepo.findOne).toHaveBeenCalledWith({
      where: { id: 'foreign-row', section_id: 's1', tenant_id: TENANT_ID },
    });
  });
});
