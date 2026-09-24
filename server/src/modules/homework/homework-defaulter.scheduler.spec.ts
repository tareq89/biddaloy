import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  HomeworkDefaulterScheduler,
  HOMEWORK_DEFAULTER_SWEEP_JOB_ID,
  HOMEWORK_DEFAULTER_SWEEP_INTERVAL_MS,
} from './homework-defaulter.scheduler';
import { HomeworkAssignmentStatus, HomeworkSubmissionStatus } from '@biddaloy/shared';

const TENANT = 'tenant-1';

describe('HomeworkDefaulterScheduler', () => {
  let queue: any;
  let assignmentRepo: any;
  let submissionRepo: any;
  let schoolsService: any;
  let homeworkNoticeService: any;
  let scheduler: HomeworkDefaulterScheduler;

  const ASSIGNMENT = {
    id: 'assign-1',
    tenant_id: TENANT,
    due_date: '2026-01-07',
    status: HomeworkAssignmentStatus.ACTIVE,
    homework: { id: 'hw-1', title: 'Chapter 3 exercises' },
  };

  beforeEach(() => {
    queue = { upsertJobScheduler: vi.fn(async () => undefined) };
    assignmentRepo = { find: vi.fn(async () => [ASSIGNMENT]) };
    submissionRepo = {
      find: vi.fn(async () => [
        { id: 'sub-1', status: HomeworkSubmissionStatus.NOT_SUBMITTED, student: { id: 's-1' } },
      ]),
    };
    schoolsService = {
      findAll: vi.fn(async () => [{ id: TENANT, name: 'Green Valley School' }]),
      getResolvedSettings: vi.fn(async () => ({ region: { timezone: 'Asia/Dhaka' } })),
    };
    homeworkNoticeService = { notifyDefaulters: vi.fn(async () => undefined) };

    scheduler = new HomeworkDefaulterScheduler(
      queue,
      assignmentRepo,
      submissionRepo,
      schoolsService,
      homeworkNoticeService,
    );
  });

  it('registers a single repeatable job with a stable id on module init', async () => {
    await scheduler.onModuleInit();

    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(1);
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      HOMEWORK_DEFAULTER_SWEEP_JOB_ID,
      { every: HOMEWORK_DEFAULTER_SWEEP_INTERVAL_MS },
      expect.any(Object),
    );
  });

  it('only sweeps ACTIVE assignments whose due_date was yesterday', async () => {
    await scheduler.process();

    expect(assignmentRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenant_id: TENANT,
          status: HomeworkAssignmentStatus.ACTIVE,
        }),
      }),
    );
  });

  it('only notifies about NOT_SUBMITTED submissions', async () => {
    await scheduler.process();

    expect(submissionRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenant_id: TENANT,
          assignment_id: 'assign-1',
          status: HomeworkSubmissionStatus.NOT_SUBMITTED,
        }),
      }),
    );
    expect(homeworkNoticeService.notifyDefaulters).toHaveBeenCalledWith(
      ASSIGNMENT,
      ASSIGNMENT.homework,
      [{ id: 's-1' }],
    );
  });

  it('sends nothing when every submission is already SUBMITTED', async () => {
    submissionRepo.find = vi.fn(async () => []);

    await scheduler.process();

    expect(homeworkNoticeService.notifyDefaulters).not.toHaveBeenCalled();
  });

  it('does nothing for a tenant with no assignments due yesterday', async () => {
    assignmentRepo.find = vi.fn(async () => []);

    await scheduler.process();

    expect(submissionRepo.find).not.toHaveBeenCalled();
    expect(homeworkNoticeService.notifyDefaulters).not.toHaveBeenCalled();
  });

  it('does not let one tenant throwing block the rest of the sweep', async () => {
    schoolsService.findAll = vi.fn(async () => [
      { id: 'tenant-broken', name: 'Broken' },
      { id: TENANT, name: 'Green Valley School' },
    ]);
    schoolsService.getResolvedSettings = vi.fn(async (id: string) => {
      if (id === 'tenant-broken') throw new Error('boom');
      return { region: { timezone: 'Asia/Dhaka' } };
    });

    await expect(scheduler.process()).resolves.not.toThrow();
    expect(homeworkNoticeService.notifyDefaulters).toHaveBeenCalledTimes(1);
  });

  it('does not let one assignment throwing block the rest of that tenant', async () => {
    assignmentRepo.find = vi.fn(async () => [{ ...ASSIGNMENT, id: 'assign-broken' }, ASSIGNMENT]);
    homeworkNoticeService.notifyDefaulters = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);

    await expect(scheduler.process()).resolves.not.toThrow();
    expect(homeworkNoticeService.notifyDefaulters).toHaveBeenCalledTimes(2);
  });
});
