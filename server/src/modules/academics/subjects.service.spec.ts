import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SubjectService } from './subjects.service';
import { Subject } from './entities/subject.entity';
import { ClassSubject } from './entities/class-subject.entity';
import { Class } from './entities/class.entity';
import { AcademicYear } from './entities/academic-year.entity';
import { SchoolSettingsReader } from '../schools/settings/school-settings-reader.service';

/** [35.1.2] group_name validation on class-subject create/update/list. */
const T = 'tenant-1';
const YEAR = 'year-1';
const BOTH = 'A subject is either group-specific or optional, not both';

async function build(existingRow?: Partial<ClassSubject>) {
  const saved: any[] = [];
  const manager: any = {
    createQueryBuilder: () => {
      const qb: any = { setLock: () => qb, where: () => qb, getOne: async () => ({ id: 's1' }) };
      return qb;
    },
    findOne: vi.fn(async () => null),
    create: vi.fn((_e: unknown, v: any) => v),
    save: vi.fn(async (_e: unknown, v: any) => {
      saved.push(v);
      return { id: 'cs1', ...v };
    }),
  };
  const csRepo: any = {
    findOne: vi.fn(async () => existingRow ?? { id: 'cs1', subject: {} }),
    find: vi.fn(async () => [{ id: 'cs1', group_name: 'Science' }]),
    save: vi.fn(async (v: any) => v),
  };
  const subjectRepo: any = { manager: { transaction: async (cb: any) => cb(manager) } };
  const ref = await Test.createTestingModule({
    providers: [
      SubjectService,
      { provide: getRepositoryToken(Subject), useValue: subjectRepo },
      { provide: getRepositoryToken(ClassSubject), useValue: csRepo },
      {
        provide: getRepositoryToken(Class),
        useValue: { findOne: async () => ({ id: 'c1', academic_year_id: YEAR }) },
      },
      {
        provide: getRepositoryToken(AcademicYear),
        useValue: { findOne: async () => ({ id: YEAR }) },
      },
      {
        provide: SchoolSettingsReader,
        useValue: { organisationVocabulary: async () => ({ groups: ['Science'] }) },
      },
    ],
  }).compile();
  return { svc: ref.get(SubjectService), saved, csRepo };
}

const attach = (svc: SubjectService, extra: object) =>
  svc.attachToClass('c1', { subject_id: 's1', academic_year_id: YEAR, ...extra } as any, T);

describe('SubjectService group_name [35.1.2]', () => {
  it('saves a group in the vocabulary', async () => {
    const { svc, saved } = await build();
    await attach(svc, { group_name: 'Science' });
    expect(saved[0].group_name).toBe('Science');
  });

  it('rejects a group outside the vocabulary (400)', async () => {
    const { svc } = await build();
    await expect(attach(svc, { group_name: 'Arts' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects group + optional together (400)', async () => {
    const { svc } = await build();
    await expect(attach(svc, { group_name: 'Science', is_optional: true })).rejects.toThrow(BOTH);
  });

  it('normalises empty string to null', async () => {
    const { svc, saved } = await build();
    await attach(svc, { group_name: '' });
    expect(saved[0].group_name).toBeNull();
  });

  it('update: null clears the group', async () => {
    const { svc, csRepo } = await build({ id: 'cs1', is_optional: false, group_name: 'Science' });
    await svc.updateClassSubject('c1', 's1', { academic_year_id: YEAR, group_name: null }, T);
    expect(csRepo.save.mock.calls[0][0].group_name).toBeNull();
  });

  it('update: setting optional on a grouped row is rejected', async () => {
    const { svc } = await build({ id: 'cs1', is_optional: false, group_name: 'Science' });
    await expect(
      svc.updateClassSubject('c1', 's1', { academic_year_id: YEAR, is_optional: true }, T),
    ).rejects.toThrow(BOTH);
  });

  it('list returns group_name', async () => {
    const { svc } = await build();
    const rows = await svc.findByClass('c1', YEAR, T);
    expect(rows[0].group_name).toBe('Science');
  });
});
