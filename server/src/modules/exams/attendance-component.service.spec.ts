import { describe, it, expect, vi } from 'vitest';
import { sectionRosterStudentIds } from '../enrollments/section-roster';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AttendanceComponentService } from './attendance-component.service';
import { Exam } from './entities/exam.entity';
import { AttendanceSummaryService } from '../attendance/attendance-summary.service';

vi.mock('../enrollments/section-roster', () => ({ sectionRosterStudentIds: vi.fn() }));
const roster = vi.mocked(sectionRosterStudentIds);

const TENANT_ID = 'tenant-1';

async function buildService(examRepoImpl: any, attendanceSummaryImpl: any) {
  const moduleRef = await Test.createTestingModule({
    providers: [
      AttendanceComponentService,
      { provide: getRepositoryToken(Exam), useValue: examRepoImpl },
      { provide: AttendanceSummaryService, useValue: attendanceSummaryImpl },
    ],
  }).compile();

  return moduleRef.get(AttendanceComponentService);
}

describe('AttendanceComponentService.computeForSection (D11)', () => {
  it('returns a reason and no values when the exam has no academic term', async () => {
    const examRepo = {
      manager: {},
      findOne: vi.fn(async () => ({ id: 'e1', academic_term: null })),
    };
    const attendanceSummaryService = { getSummariesForStudents: vi.fn() };
    const service = await buildService(examRepo, attendanceSummaryService);

    const result = await service.computeForSection({
      examId: 'e1',
      sectionId: 's1',
      fullMarks: '10',
      tenantId: TENANT_ID,
    });

    expect(result.reason).toMatch(/no academic term/i);
    expect(result.valuesByStudent.size).toBe(0);
    expect(attendanceSummaryService.getSummariesForStudents).not.toHaveBeenCalled();
  });

  it('computes percentage * full_marks, half-up rounded to 2 decimals', async () => {
    const examRepo = {
      manager: {},
      findOne: vi.fn(async () => ({
        id: 'e1',
        class_id: 'exam-class',
        academic_term: { start_date: '2026-01-01', end_date: '2026-03-31' },
      })),
    };
    const attendanceSummaryService = {
      getSummariesForStudents: vi.fn(
        async () =>
          new Map([
            ['stu-1', { attendance_percentage: 92.345 }],
            ['stu-2', { attendance_percentage: 100 }],
          ]),
      ),
    };
    roster.mockResolvedValue(['stu-1', 'stu-2']);
    const service = await buildService(examRepo, attendanceSummaryService);

    const result = await service.computeForSection({
      examId: 'e1',
      sectionId: 's1',
      fullMarks: '10',
      tenantId: TENANT_ID,
    });

    expect(result.reason).toBeNull();
    // 92.345% of 10 = 9.2345 -> half-up to 2dp = 9.23
    expect(result.valuesByStudent.get('stu-1')).toBe('9.23');
    expect(result.valuesByStudent.get('stu-2')).toBe('10.00');
    // Uses the exam's class, not the students' current class.
    expect(attendanceSummaryService.getSummariesForStudents).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      studentIds: ['stu-1', 'stu-2'],
      classId: 'exam-class',
      from: '2026-01-01',
      to: '2026-03-31',
    });
  });

  it('is null for a student with no attendance marked at all (never silently zero)', async () => {
    const examRepo = {
      manager: {},
      findOne: vi.fn(async () => ({
        id: 'e1',
        class_id: 'exam-class',
        academic_term: { start_date: '2026-01-01', end_date: '2026-03-31' },
      })),
    };
    const attendanceSummaryService = {
      getSummariesForStudents: vi.fn(
        async () => new Map([['stu-1', { attendance_percentage: null }]]),
      ),
    };
    roster.mockResolvedValue(['stu-1']);
    const service = await buildService(examRepo, attendanceSummaryService);

    const result = await service.computeForSection({
      examId: 'e1',
      sectionId: 's1',
      fullMarks: '10',
      tenantId: TENANT_ID,
    });

    expect(result.valuesByStudent.get('stu-1')).toBeNull();
  });
});
