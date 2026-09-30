import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ForbiddenException, PayloadTooLargeException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Permission, UserRole, roleHasPermission } from '@biddaloy/shared';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { StudentService, assertCanWriteProfileFields, redactHealthNotes } from './students.service';
import { CreateStudentDto, UpdateStudentDto } from './dto/students.dto';
import { Student } from './entities/student.entity';
import { Guardian } from './entities/guardian.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Class } from '../academics/entities/class.entity';

/**
 * Unit tests for `StudentService.findAllIds` [16.3.3] — the audience
 * picker's "select all matching" endpoint. The 5,000-row cap can't
 * practically be exercised against a real database (seeding that many rows
 * per test run is slow and adds nothing `students.service.integration.spec.ts`
 * doesn't already cover for filter correctness), so the repository is
 * mocked here to assert the cap boundary itself.
 */

/** A chainable QueryBuilder stub exposing only what `buildStudentIdsQuery` uses. */
function createQueryBuilderStub(result: { raw?: unknown[]; count?: number }) {
  const qb: any = {
    select: vi.fn(() => qb),
    leftJoin: vi.fn(() => qb),
    where: vi.fn(() => qb),
    andWhere: vi.fn(() => qb),
    orderBy: vi.fn(() => qb),
    addOrderBy: vi.fn(() => qb),
    offset: vi.fn(() => qb),
    limit: vi.fn(() => qb),
    getCount: vi.fn(async () => result.count ?? 0),
    getRawMany: vi.fn(async () => result.raw ?? []),
  };
  return qb;
}

const TENANT_ID = 'tenant-1';

describe('StudentService.findAllIds', () => {
  let service: StudentService;
  let repo: { createQueryBuilder: ReturnType<typeof vi.fn> };
  let qb: ReturnType<typeof createQueryBuilderStub>;

  async function build(result: Parameters<typeof createQueryBuilderStub>[0] = {}) {
    qb = createQueryBuilderStub(result);
    repo = { createQueryBuilder: vi.fn(() => qb) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        StudentService,
        { provide: getRepositoryToken(Student), useValue: repo },
        { provide: getRepositoryToken(Guardian), useValue: {} },
        { provide: getRepositoryToken(ClassSection), useValue: {} },
        { provide: getRepositoryToken(Class), useValue: {} },
      ],
    }).compile();

    service = moduleRef.get(StudentService);
  }

  it('returns the matching ids and total when under the cap', async () => {
    await build({ count: 2, raw: [{ id: 'a' }, { id: 'b' }] });

    const result = await service.findAllIds({}, TENANT_ID);

    expect(result).toEqual({ ids: ['a', 'b'], total: 2 });
  });

  it('throws 413 when the match count exceeds the 5,000 cap, without fetching rows', async () => {
    await build({ count: 5001 });

    await expect(service.findAllIds({}, TENANT_ID)).rejects.toThrow(PayloadTooLargeException);
    expect(qb.getRawMany).not.toHaveBeenCalled();
  });

  it('allows exactly 5,000 matches (the cap is inclusive)', async () => {
    await build({ count: 5000, raw: Array.from({ length: 5000 }, (_, i) => ({ id: `s${i}` })) });

    const result = await service.findAllIds({}, TENANT_ID);

    expect(result.total).toBe(5000);
    expect(result.ids).toHaveLength(5000);
  });
});

/** [39.2.1] Student profile fields: validation + permission split. */
describe('student profile fields', () => {
  const errorsFor = async (cls: any, body: object) =>
    (await validate(plainToInstance(cls, body))).map((e) => e.property);

  it('accepts all five fields on update, trimmed', async () => {
    const dto = plainToInstance(UpdateStudentDto, {
      religion: '  Islam ',
      birth_reg_no: ' 12345678901234567 ',
      health_notes: 'Asthma',
      father_name: 'A',
      mother_name: 'B',
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.religion).toBe('Islam');
    expect(dto.birth_reg_no).toBe('12345678901234567');
  });

  it('rejects birth_reg_no that is not 10-17 digits', async () => {
    for (const bad of ['123456789', '123456789012345678', '12345abcde12']) {
      expect(await errorsFor(UpdateStudentDto, { birth_reg_no: bad })).toContain('birth_reg_no');
    }
    expect(
      await errorsFor(CreateStudentDto, {
        class_section_id: 'x',
        full_name: 'n',
        birth_reg_no: '12',
      }),
    ).toContain('birth_reg_no');
  });

  it('enforces max lengths (200 / health_notes 2000)', async () => {
    expect(await errorsFor(UpdateStudentDto, { father_name: 'a'.repeat(201) })).toContain(
      'father_name',
    );
    expect(await errorsFor(UpdateStudentDto, { health_notes: 'a'.repeat(2001) })).toContain(
      'health_notes',
    );
    expect(await errorsFor(UpdateStudentDto, { health_notes: 'a'.repeat(2000) })).toHaveLength(0);
  });

  it('allows null to clear a field on update', async () => {
    expect(await errorsFor(UpdateStudentDto, { religion: null, birth_reg_no: null })).toHaveLength(
      0,
    );
  });

  it('PATCH with profile fields is 403 without STUDENT_RECORDS_WRITE, other fields still fine', () => {
    // ACCOUNTANT has STUDENT_UPDATE but not RECORDS_WRITE.
    const can = roleHasPermission(UserRole.ACCOUNTANT, Permission.STUDENT_RECORDS_WRITE);
    expect(can).toBe(false);
    expect(() => assertCanWriteProfileFields({ religion: 'x' } as any, can)).toThrow(
      ForbiddenException,
    );
    expect(() => assertCanWriteProfileFields({ full_name: 'x' } as any, can)).not.toThrow();
    expect(() => assertCanWriteProfileFields({ religion: 'x' } as any, true)).not.toThrow();
  });

  it('an explicit null still counts as a write attempt', () => {
    expect(() => assertCanWriteProfileFields({ health_notes: null } as any, false)).toThrow(
      ForbiddenException,
    );
  });

  it('redactHealthNotes strips from one, a list and a page unless RECORDS_READ', () => {
    const mk = () => ({ id: '1', health_notes: 'secret' });
    expect(redactHealthNotes(mk(), false)).not.toHaveProperty('health_notes');
    expect(redactHealthNotes([mk(), mk()], false).every((s) => !('health_notes' in s))).toBe(true);
    expect(redactHealthNotes({ data: [mk()] }, false).data[0]).not.toHaveProperty('health_notes');
    expect(redactHealthNotes(mk(), true).health_notes).toBe('secret');
  });
});
