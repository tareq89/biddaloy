import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  HomeworkAssignmentStatus,
  HomeworkSubmissionStatus,
  SyllabusTopicStatus,
} from '@biddaloy/shared';
import { HomeworkAnalyticsService } from './homework-analytics.service';

const TENANT_ID = 'tenant-1';

function makeRepo(rows: unknown[]) {
  return { find: vi.fn().mockResolvedValue(rows) } as any;
}

describe('HomeworkAnalyticsService', () => {
  let assignmentRepo: any;
  let submissionRepo: any;
  let syllabusRepo: any;
  let service: HomeworkAnalyticsService;

  beforeEach(() => {
    assignmentRepo = makeRepo([]);
    submissionRepo = makeRepo([]);
    syllabusRepo = makeRepo([]);
    service = new HomeworkAnalyticsService(assignmentRepo, submissionRepo, syllabusRepo);
  });

  describe('getStudentRollup', () => {
    it('2 submitted, 1 defaulter (past due, not submitted) -> 66% completion', async () => {
      const today = '2026-06-10';
      submissionRepo.find.mockResolvedValue([
        {
          assignment_id: 'a1',
          status: HomeworkSubmissionStatus.SUBMITTED,
          assignment: { due_date: '2026-06-01' },
        },
        {
          assignment_id: 'a2',
          status: HomeworkSubmissionStatus.DONE,
          assignment: { due_date: '2026-06-01' },
        },
        {
          assignment_id: 'a3',
          status: HomeworkSubmissionStatus.NOT_SUBMITTED,
          assignment: { due_date: '2026-06-01' }, // due date already passed today
        },
      ]);

      const rollup = await service.getStudentRollup('student-1', TENANT_ID, 'UTC');

      // localToday('UTC') is used internally — force determinism by faking
      // a due date safely in the past relative to "now" rather than mocking
      // Date; 2026-06-01 is in the past for any real clock this test runs
      // under after that date, so pin an assignment due_date far enough back.
      expect(rollup.totalAssignments).toBe(3);
      expect(rollup.completed).toBe(2);
      expect(rollup.defaulters).toBe(1);
      expect(rollup.completionPercent).toBe(66);
      void today;
    });

    it('no submissions -> 0% completion, no division by zero', async () => {
      const rollup = await service.getStudentRollup('student-1', TENANT_ID);
      expect(rollup).toEqual({
        totalAssignments: 0,
        completed: 0,
        defaulters: 0,
        completionPercent: 0,
      });
    });

    it('not-yet-due, not-submitted is neither completed nor a defaulter', async () => {
      const farFuture = '2999-01-01';
      submissionRepo.find.mockResolvedValue([
        {
          assignment_id: 'a1',
          status: HomeworkSubmissionStatus.NOT_SUBMITTED,
          assignment: { due_date: farFuture },
        },
      ]);
      const rollup = await service.getStudentRollup('student-1', TENANT_ID);
      expect(rollup.completed).toBe(0);
      expect(rollup.defaulters).toBe(0);
      expect(rollup.completionPercent).toBe(0);
    });
  });

  describe('getSectionRollup', () => {
    it('rolls up submissions across every assignment targeting the section', async () => {
      assignmentRepo.find.mockResolvedValue([
        { id: 'a1', due_date: '2020-01-01', status: HomeworkAssignmentStatus.ACTIVE },
      ]);
      submissionRepo.find.mockResolvedValue([
        { assignment_id: 'a1', status: HomeworkSubmissionStatus.PARTIAL },
      ]);
      const rollup = await service.getSectionRollup('section-1', TENANT_ID);
      expect(rollup.totalAssignments).toBe(1);
      expect(rollup.completed).toBe(1);
      expect(rollup.completionPercent).toBe(100);
    });

    it('no assignments for the section -> zeroed rollup, no query for submissions', async () => {
      const rollup = await service.getSectionRollup('section-1', TENANT_ID);
      expect(rollup).toEqual({
        totalAssignments: 0,
        completed: 0,
        defaulters: 0,
        completionPercent: 0,
      });
      expect(submissionRepo.find).not.toHaveBeenCalled();
    });
  });

  describe('getClassRollup', () => {
    it('adds a syllabus completion percent (D29) alongside the homework rollup', async () => {
      assignmentRepo.find.mockResolvedValue([
        { id: 'a1', due_date: '2020-01-01', homework: { class_id: 'class-1' } },
      ]);
      submissionRepo.find.mockResolvedValue([
        { assignment_id: 'a1', status: HomeworkSubmissionStatus.DONE },
      ]);
      syllabusRepo.find.mockResolvedValue([
        { status: SyllabusTopicStatus.DONE },
        { status: SyllabusTopicStatus.DONE },
        { status: SyllabusTopicStatus.PLANNED },
      ]);

      const rollup = await service.getClassRollup('class-1', TENANT_ID);

      expect(rollup.completionPercent).toBe(100);
      expect(rollup.syllabus).toEqual({ totalTopics: 3, done: 2, completionPercent: 66 });
    });
  });
});
