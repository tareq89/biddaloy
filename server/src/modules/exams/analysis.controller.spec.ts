import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { ExamStatus } from '@biddaloy/shared';
import { AnalysisController } from './analysis.controller';

const TENANT = { id: 'tenant-1', role: 'ADMIN' };
const EXAM_ID = 'exam-1';
const USER: any = { sub: 'user-1' };

function makeController(overrides: Record<string, any> = {}) {
  const analysisService: any = {
    getMerit: vi.fn(async () => ({ status: ExamStatus.PROCESSED, rows: [] })),
    getDefaulted: vi.fn(async () => ({ status: ExamStatus.PROCESSED, rows: [] })),
    getPassFail: vi.fn(async () => ({
      status: ExamStatus.PROCESSED,
      subjects: [],
      overall: {
        subject_id: null,
        subject_name: 'Overall',
        appeared: 0,
        passed: 0,
        failed: 0,
        absent: 0,
        pass_pct: 0,
        highest: null,
        average: null,
        grade_distribution: {},
      },
    })),
    getPassFailComponents: vi.fn(async () => ({ status: ExamStatus.PROCESSED, rows: [] })),
    ...overrides.analysisService,
  };
  const examRepo: any = {
    findOne: vi.fn(async () => ({ id: EXAM_ID, name: 'Term Exam' })),
    ...overrides.examRepo,
  };
  // null = tenant-wide role (no restriction); an array = a TEACHER's current-year sections.
  const teacherScope: any = {
    sectionScope: vi.fn(async () => null),
    ...overrides.teacherScope,
  };
  return {
    controller: new AnalysisController(analysisService, examRepo, teacherScope),
    analysisService,
    examRepo,
    teacherScope,
  };
}

describe('AnalysisController', () => {
  it('delegates GET merit to the service with the tenant and section filter', async () => {
    const { controller, analysisService } = makeController();
    await controller.getMerit(EXAM_ID, { section_id: 'sec-1' }, TENANT, USER);
    expect(analysisService.getMerit).toHaveBeenCalledWith(EXAM_ID, TENANT.id, 'sec-1', undefined);
  });

  it('delegates GET defaulted to the service', async () => {
    const { controller, analysisService } = makeController();
    await controller.getDefaulted(EXAM_ID, {}, TENANT, USER);
    expect(analysisService.getDefaulted).toHaveBeenCalledWith(
      EXAM_ID,
      TENANT.id,
      undefined,
      undefined,
    );
  });

  it('delegates GET pass-fail to the service', async () => {
    const { controller, analysisService } = makeController();
    await controller.getPassFail(EXAM_ID, {}, TENANT, USER);
    expect(analysisService.getPassFail).toHaveBeenCalledWith(
      EXAM_ID,
      TENANT.id,
      undefined,
      undefined,
    );
  });

  it('delegates GET pass-fail/components to the service', async () => {
    const { controller, analysisService } = makeController();
    await controller.getPassFailComponents(EXAM_ID, {}, TENANT, USER);
    expect(analysisService.getPassFailComponents).toHaveBeenCalledWith(
      EXAM_ID,
      TENANT.id,
      undefined,
      undefined,
    );
  });

  it('merit.csv sets a CSV content type and a filename derived from the exam name', async () => {
    const { controller } = makeController({
      analysisService: {
        getMerit: vi.fn(async () => ({
          status: ExamStatus.PROCESSED,
          rows: [
            {
              student_id: 's1',
              roll_number: 1,
              full_name: 'Amin',
              section_id: null,
              section_name: null,
              total_marks: 400,
              gpa: 4.5,
              grade: 'A',
              position: 1,
              section_position: null,
              is_fail: false,
            },
          ],
        })),
      },
    });
    const res: any = { setHeader: vi.fn(), attachment: vi.fn() };
    const file = await controller.getMeritCsv(EXAM_ID, {}, TENANT, USER, res);
    expect(res.attachment).toHaveBeenCalledWith('Term Exam-merit.csv');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
    expect(file).toBeDefined();
  });

  it('404s the CSV route when the exam is not in the tenant', async () => {
    const { controller } = makeController({ examRepo: { findOne: vi.fn(async () => null) } });
    const res: any = { setHeader: vi.fn(), attachment: vi.fn() };
    await expect(controller.getMeritCsv(EXAM_ID, {}, TENANT, USER, res)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  // Epic 75 D2/D13: TEACHER is limited to current-year assigned sections.
  it('TEACHER: passes the assigned section ids to the service', async () => {
    const { controller, analysisService } = makeController({
      teacherScope: { sectionScope: vi.fn(async () => ['sec-a']) },
    });
    await controller.getMerit(EXAM_ID, {}, { id: 'tenant-1', role: 'TEACHER' }, USER);
    expect(analysisService.getMerit).toHaveBeenCalledWith(EXAM_ID, 'tenant-1', undefined, [
      'sec-a',
    ]);
  });

  it('TEACHER: a section_id outside the assigned sections is a 404', async () => {
    const { controller, analysisService } = makeController({
      teacherScope: { sectionScope: vi.fn(async () => ['sec-a']) },
    });
    await expect(
      controller.getMerit(
        EXAM_ID,
        { section_id: 'sec-b' },
        { id: 'tenant-1', role: 'TEACHER' },
        USER,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(analysisService.getMerit).not.toHaveBeenCalled();
  });
});
