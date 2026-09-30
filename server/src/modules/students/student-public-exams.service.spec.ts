import 'reflect-metadata';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AuditAction, PublicExamType } from '@biddaloy/shared';
import { StudentPublicExamsService } from './student-public-exams.service';
import { CreateStudentPublicExamDto } from './dto/student-public-exams.dto';

const TENANT = 't1';
const STUDENT = 's1';
const USER = 'u1';

const validBody = {
  exam_type: PublicExamType.SSC,
  board: 'Dhaka',
  roll_no: '123456',
  registration_no: '987654',
  gpa: 4.5,
  passing_year: 2020,
};

async function errorsFor(patch: Record<string, unknown>) {
  const dto = plainToInstance(CreateStudentPublicExamDto, { ...validBody, ...patch });
  return (await validate(dto)).map((e) => e.property);
}

describe('CreateStudentPublicExamDto bounds', () => {
  it('accepts a valid body and a missing gpa', async () => {
    expect(await errorsFor({})).toEqual([]);
    expect(await errorsFor({ gpa: undefined })).toEqual([]);
  });

  it.each([-0.01, 5.01, 4.555])('rejects gpa %s', async (gpa) => {
    expect(await errorsFor({ gpa })).toEqual(['gpa']);
  });

  it.each([0, 5, 3.75])('accepts gpa %s', async (gpa) => {
    expect(await errorsFor({ gpa })).toEqual([]);
  });

  it('rejects passing_year below 1990 and accepts 1990', async () => {
    expect(await errorsFor({ passing_year: 1989 })).toEqual(['passing_year']);
    expect(await errorsFor({ passing_year: 1990 })).toEqual([]);
  });

  it('rejects an unknown exam_type', async () => {
    expect(await errorsFor({ exam_type: 'MBA' })).toEqual(['exam_type']);
  });
});

describe('StudentPublicExamsService', () => {
  let service: StudentPublicExamsService;
  let studentRepo: { findOne: ReturnType<typeof vi.fn> };
  let examRepo: Record<string, ReturnType<typeof vi.fn>>;
  let audit: { record: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    studentRepo = { findOne: vi.fn(async () => ({ id: STUDENT })) };
    examRepo = {
      findOne: vi.fn(async () => null),
      find: vi.fn(async () => []),
      create: vi.fn((x) => x),
      save: vi.fn(async (x) => ({ id: 'e1', ...x })),
      softDelete: vi.fn(async () => undefined),
    };
    const manager: any = {
      getRepository: (entity: { name: string }) =>
        entity.name === 'Student' ? studentRepo : examRepo,
    };
    manager.transaction = async (cb: (m: unknown) => unknown) => cb(manager);
    manager.manager = manager;
    audit = { record: vi.fn(async () => undefined) };
    service = new StudentPublicExamsService(examRepo as any, manager, audit as any);
  });

  const create = (patch: Record<string, unknown> = {}) =>
    service.create(STUDENT, { ...validBody, ...patch } as any, TENANT, USER);

  it('creates, formats gpa to 2 decimals, scopes by tenant, and audits', async () => {
    const row = await create({ gpa: 4.5 });
    expect(row).toMatchObject({ gpa: '4.50', tenant_id: TENANT, student_id: STUDENT });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.CREATE,
        tenant_id: TENANT,
        performed_by_user_id: USER,
        entity_id: STUDENT,
      }),
      expect.anything(),
    );
  });

  it('stores null gpa when explicitly null (no 500)', async () => {
    expect(await create({ gpa: null as unknown as undefined })).toMatchObject({ gpa: null });
  });

  it('stores null gpa when omitted', async () => {
    expect(await create({ gpa: undefined })).toMatchObject({ gpa: null });
  });

  it('rejects passing_year beyond current year + 1, accepts the boundary', async () => {
    const max = new Date().getFullYear() + 1;
    await expect(create({ passing_year: max + 1 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(create({ passing_year: max })).resolves.toBeDefined();
  });

  it('409s on a duplicate live exam_type and writes nothing', async () => {
    examRepo.findOne.mockResolvedValueOnce({ id: 'existing' });
    await expect(create()).rejects.toBeInstanceOf(ConflictException);
    expect(examRepo.save).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('404s when the student is not in the tenant', async () => {
    studentRepo.findOne.mockResolvedValueOnce(null);
    await expect(create()).rejects.toBeInstanceOf(NotFoundException);
  });

  it('update 404s on a missing row; remove soft-deletes and audits', async () => {
    await expect(
      service.update(STUDENT, 'e1', { board: 'X' }, TENANT, USER),
    ).rejects.toBeInstanceOf(NotFoundException);

    examRepo.findOne.mockResolvedValueOnce({ id: 'e1', student_id: STUDENT, gpa: '4.00' });
    await service.remove(STUDENT, 'e1', TENANT, USER);
    expect(examRepo.softDelete).toHaveBeenCalledWith({ id: 'e1', tenant_id: TENANT });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.DELETE }),
      expect.anything(),
    );
  });
});
