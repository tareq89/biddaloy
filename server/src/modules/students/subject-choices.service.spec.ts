import { describe, it, expect, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';
import { SubjectChoicesService } from './subject-choices.service';
import { Student } from './entities/student.entity';
import { StudentSubjectChoice } from './entities/student-subject-choice.entity';
import { ClassSubject } from '../academics/entities/class-subject.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { AuditService } from '../audit/audit.service';

/**
 * Unit tests for 19.3.1's `SubjectChoicesService` — listing optional
 * subjects (issue rule #6), setting the fourth-subject choice, the
 * one-`is_fourth`-per-student-per-year rule enforced at the service level
 * (issue rule #5/Tests), and tenant isolation.
 */

const TENANT_ID = 'tenant-1';
const STUDENT_ID = 'student-1';
const YEAR_ID = 'year-1';

function createChoiceRepoStub() {
  const repo: any = {
    create: vi.fn((v: any) => v),
    save: vi.fn(async (v: any) => ({ id: 'choice-1', ...v })),
    update: vi.fn(async () => undefined),
    find: vi.fn(async () => []),
    findOne: vi.fn(async () => null),
  };
  repo.manager = {
    transaction: vi.fn(async (cb: any) => cb({ getRepository: () => repo })),
  };
  return repo;
}

async function buildService() {
  const studentRepo: any = {
    findOne: vi.fn(async () => ({
      id: STUDENT_ID,
      tenant_id: TENANT_ID,
      class_section_id: 'sec-1',
    })),
  };
  const sectionRepo: any = {
    findOne: vi.fn(async () => ({ id: 'sec-1', tenant_id: TENANT_ID, class_id: 'class-1' })),
  };
  const classSubjectRepo: any = {
    find: vi.fn(async () => []),
    findOne: vi.fn(async () => null),
  };
  const choiceRepo = createChoiceRepoStub();
  const auditService = { record: vi.fn(async () => undefined) };

  const moduleRef = await Test.createTestingModule({
    providers: [
      SubjectChoicesService,
      { provide: getRepositoryToken(Student), useValue: studentRepo },
      { provide: getRepositoryToken(ClassSection), useValue: sectionRepo },
      { provide: getRepositoryToken(ClassSubject), useValue: classSubjectRepo },
      { provide: getRepositoryToken(StudentSubjectChoice), useValue: choiceRepo },
      { provide: AuditService, useValue: auditService },
    ],
  }).compile();

  return {
    service: moduleRef.get(SubjectChoicesService),
    studentRepo,
    sectionRepo,
    classSubjectRepo,
    choiceRepo,
  };
}

describe('SubjectChoicesService.listOptions', () => {
  it("lists optional subjects for the student's class/year, flagging the chosen one", async () => {
    const { service, classSubjectRepo, choiceRepo } = await buildService();
    classSubjectRepo.find = vi.fn(async () => [
      { id: 'cs-1', subject_id: 'subj-1' },
      { id: 'cs-2', subject_id: 'subj-2' },
    ]);
    choiceRepo.find = vi.fn(async () => [{ class_subject_id: 'cs-1', is_fourth: true }]);

    const options = await service.listOptions(STUDENT_ID, YEAR_ID, TENANT_ID);

    expect(options).toEqual([
      { class_subject_id: 'cs-1', subject_id: 'subj-1', chosen: true, is_fourth: true },
      { class_subject_id: 'cs-2', subject_id: 'subj-2', chosen: false, is_fourth: false },
    ]);
    expect(classSubjectRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          class_id: 'class-1',
          academic_year_id: YEAR_ID,
          is_optional: true,
          tenant_id: TENANT_ID,
        }),
      }),
    );
  });

  it("a request for another tenant's student returns not-found", async () => {
    const { service, studentRepo } = await buildService();
    studentRepo.findOne = vi.fn(async () => null);

    await expect(service.listOptions(STUDENT_ID, YEAR_ID, 'other-tenant')).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('SubjectChoicesService.setChoice', () => {
  it('creates a new choice', async () => {
    const { service, classSubjectRepo, choiceRepo } = await buildService();
    classSubjectRepo.findOne = vi.fn(async () => ({
      id: 'cs-1',
      class_id: 'class-1',
      academic_year_id: YEAR_ID,
      is_optional: true,
    }));

    const result = await service.setChoice(
      STUDENT_ID,
      { class_subject_id: 'cs-1', is_fourth: false } as any,
      TENANT_ID,
    );

    expect(result).toMatchObject({ class_subject_id: 'cs-1', is_fourth: false });
    expect(choiceRepo.save).toHaveBeenCalled();
  });

  it('rejects an unknown/non-optional class-subject', async () => {
    const { service, classSubjectRepo } = await buildService();
    classSubjectRepo.findOne = vi.fn(async () => null);

    await expect(
      service.setChoice(
        STUDENT_ID,
        { class_subject_id: 'cs-1', is_fourth: false } as any,
        TENANT_ID,
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('allows one is_fourth choice per student per year', async () => {
    const { service, classSubjectRepo, choiceRepo } = await buildService();
    classSubjectRepo.findOne = vi.fn(async () => ({
      id: 'cs-1',
      class_id: 'class-1',
      academic_year_id: YEAR_ID,
      is_optional: true,
    }));
    choiceRepo.findOne = vi.fn(async () => null);

    await expect(
      service.setChoice(
        STUDENT_ID,
        { class_subject_id: 'cs-1', is_fourth: true } as any,
        TENANT_ID,
      ),
    ).resolves.toMatchObject({ is_fourth: true });
  });

  it('replaces a different existing fourth-subject choice atomically, rather than rejecting the PUT', async () => {
    const { service, classSubjectRepo, choiceRepo } = await buildService();
    classSubjectRepo.findOne = vi.fn(async () => ({
      id: 'cs-2',
      class_id: 'class-1',
      academic_year_id: YEAR_ID,
      is_optional: true,
    }));
    // An existing is_fourth choice already set on a *different* class_subject
    // — this is the panel's normal "change your mind" path (re-PUT with a
    // different class_subject_id), not a conflict to reject.
    choiceRepo.findOne = vi.fn(async (opts: any) => {
      if (opts?.where?.is_fourth) {
        return { id: 'choice-existing', class_subject_id: 'cs-1', is_fourth: true };
      }
      return null;
    });

    const result = await service.setChoice(
      STUDENT_ID,
      { class_subject_id: 'cs-2', is_fourth: true } as any,
      TENANT_ID,
    );

    expect(result).toMatchObject({ class_subject_id: 'cs-2', is_fourth: true });
    // The old fourth-subject row is demoted, not left dangling at is_fourth:true.
    expect(choiceRepo.update).toHaveBeenCalledWith({ id: 'choice-existing' }, { is_fourth: false });
  });

  it('re-setting is_fourth on the same class_subject that already holds it is not a conflict', async () => {
    const { service, classSubjectRepo, choiceRepo } = await buildService();
    classSubjectRepo.findOne = vi.fn(async () => ({
      id: 'cs-1',
      class_id: 'class-1',
      academic_year_id: YEAR_ID,
      is_optional: true,
    }));
    choiceRepo.findOne = vi.fn(async (opts: any) => {
      if (opts?.where?.is_fourth) {
        return { id: 'choice-existing', class_subject_id: 'cs-1', is_fourth: true };
      }
      return { id: 'choice-existing', class_subject_id: 'cs-1', is_fourth: true };
    });

    await expect(
      service.setChoice(
        STUDENT_ID,
        { class_subject_id: 'cs-1', is_fourth: true } as any,
        TENANT_ID,
      ),
    ).resolves.toBeDefined();
  });

  it("rejects a class-subject offering from a different class than the student's own (cross-class)", async () => {
    const { service, classSubjectRepo } = await buildService();
    // listOptions only ever surfaces offerings from the student's own
    // class (class-1); this one belongs to a different class.
    classSubjectRepo.findOne = vi.fn(async () => ({
      id: 'cs-other-class',
      class_id: 'class-2',
      academic_year_id: YEAR_ID,
      is_optional: true,
    }));

    await expect(
      service.setChoice(
        STUDENT_ID,
        { class_subject_id: 'cs-other-class', is_fourth: false } as any,
        TENANT_ID,
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('maps a concurrent unique-index violation to 409, not a raw 500', async () => {
    const { service, classSubjectRepo, choiceRepo } = await buildService();
    classSubjectRepo.findOne = vi.fn(async () => ({
      id: 'cs-1',
      class_id: 'class-1',
      academic_year_id: YEAR_ID,
      is_optional: true,
    }));
    // Both pre-checks pass (no existing is_fourth row, no existing choice
    // row) — a concurrent request wins the race and the DB itself rejects
    // this one's insert.
    choiceRepo.findOne = vi.fn(async () => null);
    choiceRepo.save = vi.fn(async () => {
      throw new QueryFailedError(
        'insert',
        [],
        Object.assign(new Error('duplicate'), { code: '23505' }),
      );
    });

    await expect(
      service.setChoice(
        STUDENT_ID,
        { class_subject_id: 'cs-1', is_fourth: true } as any,
        TENANT_ID,
      ),
    ).rejects.toThrow(ConflictException);
  });
});
