import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { ExamStatus } from '@biddaloy/shared';
import { AnalysisController } from './analysis.controller';

const TENANT = { id: 'tenant-1', role: 'ADMIN' };
const EXAM_ID = 'exam-1';

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
  return {
    controller: new AnalysisController(analysisService, examRepo),
    analysisService,
    examRepo,
  };
}

describe('AnalysisController', () => {
  it('delegates GET merit to the service with the tenant and section filter', async () => {
    const { controller, analysisService } = makeController();
    await controller.getMerit(EXAM_ID, { section_id: 'sec-1' }, TENANT);
    expect(analysisService.getMerit).toHaveBeenCalledWith(EXAM_ID, TENANT.id, 'sec-1');
  });

  it('delegates GET defaulted to the service', async () => {
    const { controller, analysisService } = makeController();
    await controller.getDefaulted(EXAM_ID, {}, TENANT);
    expect(analysisService.getDefaulted).toHaveBeenCalledWith(EXAM_ID, TENANT.id, undefined);
  });

  it('delegates GET pass-fail to the service', async () => {
    const { controller, analysisService } = makeController();
    await controller.getPassFail(EXAM_ID, {}, TENANT);
    expect(analysisService.getPassFail).toHaveBeenCalledWith(EXAM_ID, TENANT.id, undefined);
  });

  it('delegates GET pass-fail/components to the service', async () => {
    const { controller, analysisService } = makeController();
    await controller.getPassFailComponents(EXAM_ID, {}, TENANT);
    expect(analysisService.getPassFailComponents).toHaveBeenCalledWith(
      EXAM_ID,
      TENANT.id,
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
    const res: any = { setHeader: vi.fn() };
    const file = await controller.getMeritCsv(EXAM_ID, {}, TENANT, res);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringContaining('Term Exam-merit.csv'),
    );
    expect(file).toBeDefined();
  });

  it('404s the CSV route when the exam is not in the tenant', async () => {
    const { controller } = makeController({ examRepo: { findOne: vi.fn(async () => null) } });
    const res: any = { setHeader: vi.fn() };
    await expect(controller.getMeritCsv(EXAM_ID, {}, TENANT, res)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
