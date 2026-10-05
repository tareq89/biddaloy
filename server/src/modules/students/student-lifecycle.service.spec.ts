import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { StudentLifecycleService } from './student-lifecycle.service';
import { StudentLifecycleEvent } from './entities/student-lifecycle-event.entity';
import { Student } from './entities/student.entity';
import { Enrollment } from './entities/enrollment.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Class } from '../academics/entities/class.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { EnrollmentService } from '../enrollments/enrollments.service';
import { AuditService } from '../audit/audit.service';
import { LeaveStudentDto, ReadmitStudentDto } from './dto/student-lifecycle.dto';
import { todayInSchoolTz } from '../../common/time';

const TENANT = 'tenant-1';
const STUDENT_ID = 'student-1';
const CTX = { ip: '1.1.1.1', userAgent: 'ua' };

function repoStub() {
  return {
    findOne: vi.fn(),
    update: vi.fn(async () => undefined),
    create: vi.fn((v: unknown) => v),
    save: vi.fn(async (v: object) => ({ id: 'event-1', ...v })),
  };
}

async function errorsFor<T extends object>(cls: new () => T, plain: object): Promise<string[]> {
  const errs = await validate(plainToInstance(cls, plain));
  return errs.map((e) => e.property);
}

describe('StudentLifecycleService', () => {
  let service: StudentLifecycleService;
  let stubs: Map<unknown, ReturnType<typeof repoStub>>;
  let enrollmentService: { createInTransaction: ReturnType<typeof vi.fn> };
  let audit: { record: ReturnType<typeof vi.fn> };

  const student = (status: string) => ({
    id: STUDENT_ID,
    tenant_id: TENANT,
    enrollment_status: status,
    class_section_id: 'sec-1',
  });
  const activeEnrollment = {
    id: 'enr-1',
    academic_year_id: 'year-1',
    enrollment_status: 'ACTIVE',
  };

  beforeEach(async () => {
    stubs = new Map();
    for (const e of [
      Student,
      Enrollment,
      StudentLifecycleEvent,
      ClassSection,
      Class,
      AcademicYear,
    ]) {
      stubs.set(e, repoStub());
    }
    const manager = {
      getRepository: (e: unknown) => stubs.get(e),
      query: vi.fn().mockResolvedValue([{ seat_limit: null }]),
    };
    enrollmentService = { createInTransaction: vi.fn(async () => ({ id: 'enr-new' })) };
    audit = { record: vi.fn(async () => undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        StudentLifecycleService,
        {
          provide: getRepositoryToken(StudentLifecycleEvent),
          useValue: {
            manager: { transaction: vi.fn((cb: (m: unknown) => unknown) => cb(manager)) },
          },
        },
        { provide: EnrollmentService, useValue: enrollmentService },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();
    service = moduleRef.get(StudentLifecycleService);
  });

  const leaveDto = (type: 'WITHDRAWN' | 'TRANSFERRED_OUT' | 'GRADUATED') =>
    ({ type, occurred_on: '2026-01-01', reason: 'why' }) as LeaveStudentDto;

  function primeLeave() {
    stubs.get(Student)!.findOne.mockResolvedValue(student('ACTIVE'));
    stubs.get(Enrollment)!.findOne.mockResolvedValue(activeEnrollment);
  }

  describe('DTO validation', () => {
    const valid = { type: 'WITHDRAWN', occurred_on: todayInSchoolTz(), reason: 'moved' };

    it('rejects a future occurred_on on leave', async () => {
      expect(await errorsFor(LeaveStudentDto, { ...valid, occurred_on: '2999-01-01' })).toContain(
        'occurred_on',
      );
    });

    it('accepts today on leave', async () => {
      expect(await errorsFor(LeaveStudentDto, valid)).toEqual([]);
    });

    it('rejects a datetime occurred_on', async () => {
      expect(
        await errorsFor(LeaveStudentDto, { ...valid, occurred_on: '2026-01-01T10:00:00Z' }),
      ).toContain('occurred_on');
    });

    it('rejects type READMITTED on leave', async () => {
      expect(await errorsFor(LeaveStudentDto, { ...valid, type: 'READMITTED' })).toContain('type');
    });

    it('rejects a whitespace-only reason', async () => {
      expect(await errorsFor(LeaveStudentDto, { ...valid, reason: '   ' })).toContain('reason');
    });

    it('rejects a future occurred_on on readmit', async () => {
      const errs = await errorsFor(ReadmitStudentDto, {
        occurred_on: '2999-01-01',
        class_section_id: '00000000-0000-4000-8000-000000000040',
      });
      expect(errs).toContain('occurred_on');
    });

    it('rejects a non-UUID class_section_id on readmit', async () => {
      const errs = await errorsFor(ReadmitStudentDto, {
        occurred_on: todayInSchoolTz(),
        class_section_id: 'nope',
      });
      expect(errs).toContain('class_section_id');
    });
  });

  it('leave: 404 when the student is not found', async () => {
    stubs.get(Student)!.findOne.mockResolvedValue(null);
    await expect(
      service.leave(STUDENT_ID, leaveDto('WITHDRAWN'), TENANT, 'u1', CTX),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('leave: 409 and no writes when there is no ACTIVE enrollment', async () => {
    stubs.get(Student)!.findOne.mockResolvedValue(student('ACTIVE'));
    stubs.get(Enrollment)!.findOne.mockResolvedValue(null);
    await expect(
      service.leave(STUDENT_ID, leaveDto('WITHDRAWN'), TENANT, 'u1', CTX),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(stubs.get(StudentLifecycleEvent)!.save).not.toHaveBeenCalled();
    expect(stubs.get(Enrollment)!.update).not.toHaveBeenCalled();
    expect(stubs.get(Student)!.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('readmit: 409 and no writes when the student is already ACTIVE', async () => {
    stubs.get(Student)!.findOne.mockResolvedValue(student('ACTIVE'));
    await expect(
      service.readmit(
        STUDENT_ID,
        { occurred_on: '2026-01-01', class_section_id: 'sec-2' },
        TENANT,
        'u1',
        CTX,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(stubs.get(StudentLifecycleEvent)!.save).not.toHaveBeenCalled();
    expect(stubs.get(Student)!.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('leave WITHDRAWN sets Enrollment and Student to INACTIVE', async () => {
    primeLeave();
    await service.leave(STUDENT_ID, leaveDto('WITHDRAWN'), TENANT, 'u1', CTX);
    expect(stubs.get(Enrollment)!.update).toHaveBeenCalledWith(
      { id: 'enr-1', tenant_id: TENANT },
      { enrollment_status: 'INACTIVE' },
    );
    expect(stubs.get(Student)!.update).toHaveBeenCalledWith(
      { id: STUDENT_ID, tenant_id: TENANT },
      { enrollment_status: 'INACTIVE' },
    );
    expect(audit.record).toHaveBeenCalledTimes(2);
  });

  it('leave TRANSFERRED_OUT sets TRANSFERRED', async () => {
    primeLeave();
    await service.leave(STUDENT_ID, leaveDto('TRANSFERRED_OUT'), TENANT, 'u1', CTX);
    expect(stubs.get(Enrollment)!.update).toHaveBeenCalledWith(expect.anything(), {
      enrollment_status: 'TRANSFERRED',
    });
    expect(stubs.get(Student)!.update).toHaveBeenCalledWith(expect.anything(), {
      enrollment_status: 'TRANSFERRED',
    });
  });

  it('leave GRADUATED sets GRADUATED', async () => {
    primeLeave();
    await service.leave(STUDENT_ID, leaveDto('GRADUATED'), TENANT, 'u1', CTX);
    expect(stubs.get(Enrollment)!.update).toHaveBeenCalledWith(expect.anything(), {
      enrollment_status: 'GRADUATED',
    });
    expect(stubs.get(Student)!.update).toHaveBeenCalledWith(expect.anything(), {
      enrollment_status: 'GRADUATED',
    });
  });

  it('readmit into a different year creates an enrollment in the tx and writes one audit row', async () => {
    stubs.get(Student)!.findOne.mockResolvedValue(student('INACTIVE'));
    stubs.get(ClassSection)!.findOne.mockResolvedValue({ id: 'sec-2', class_id: 'cls-2' });
    stubs.get(Class)!.findOne.mockResolvedValue({ id: 'cls-2', academic_year_id: 'year-2' });
    stubs.get(AcademicYear)!.findOne.mockResolvedValue({ id: 'year-2' });
    // no ACTIVE row in year-2, no previous row in year-2
    stubs.get(Enrollment)!.findOne.mockResolvedValue(null);

    const event = await service.readmit(
      STUDENT_ID,
      { occurred_on: '2026-01-01', class_section_id: 'sec-2' },
      TENANT,
      'u1',
      CTX,
    );

    expect(enrollmentService.createInTransaction).toHaveBeenCalledTimes(1);
    expect(enrollmentService.createInTransaction.mock.calls[0][0]).toHaveProperty('getRepository');
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record.mock.calls[0][0]).toMatchObject({ entity_type: 'Student' });
    expect(event).toMatchObject({
      enrollment_id: 'enr-new',
      academic_year_id: 'year-2',
      reason: '',
    });
    expect(stubs.get(Student)!.update).toHaveBeenCalledWith(expect.anything(), {
      enrollment_status: 'ACTIVE',
    });
  });
});
