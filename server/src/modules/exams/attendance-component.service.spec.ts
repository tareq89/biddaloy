import { describe, it, expect, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AttendanceComponentService } from './attendance-component.service';
import { Exam } from './entities/exam.entity';
import { AttendanceSummaryService } from '../attendance/attendance-summary.service';

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
    const examRepo = { findOne: vi.fn(async () => ({ id: 'e1', academic_term: null })) };
    const attendanceSummaryService = { getSectionSummary: vi.fn() };
    const service = await buildService(examRepo, attendanceSummaryService);

    const result = await service.computeForSection({
      examId: 'e1',
      sectionId: 's1',
      fullMarks: '10',
      tenantId: TENANT_ID,
    });

    expect(result.reason).toMatch(/no academic term/i);
    expect(result.valuesByStudent.size).toBe(0);
    expect(attendanceSummaryService.getSectionSummary).not.toHaveBeenCalled();
  });

  it('computes percentage * full_marks, half-up rounded to 2 decimals', async () => {
    const examRepo = {
      findOne: vi.fn(async () => ({
        id: 'e1',
        academic_term: { start_date: '2026-01-01', end_date: '2026-03-31' },
      })),
    };
    const attendanceSummaryService = {
      getSectionSummary: vi.fn(async () => ({
        students: [
          { student_id: 'stu-1', attendance_percentage: 92.345 },
          { student_id: 'stu-2', attendance_percentage: 100 },
        ],
      })),
    };
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
    expect(attendanceSummaryService.getSectionSummary).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      sectionId: 's1',
      from: '2026-01-01',
      to: '2026-03-31',
    });
  });

  it('is null for a student with no attendance marked at all (never silently zero)', async () => {
    const examRepo = {
      findOne: vi.fn(async () => ({
        id: 'e1',
        academic_term: { start_date: '2026-01-01', end_date: '2026-03-31' },
      })),
    };
    const attendanceSummaryService = {
      getSectionSummary: vi.fn(async () => ({
        students: [{ student_id: 'stu-1', attendance_percentage: null }],
      })),
    };
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
