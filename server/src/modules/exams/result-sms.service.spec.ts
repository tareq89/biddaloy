import { describe, it, expect, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { ResultSmsService } from './result-sms.service';
import { Exam } from './entities/exam.entity';
import { Result } from './entities/result.entity';
import { Student } from '../students/entities/student.entity';
import { CommunicationLog } from '../communications/entities/communication-log.entity';
import { SmsCreditService } from '../communications/credits/sms-credit.service';
import { COMMUNICATIONS_QUEUE } from '../communications/communications.constants';
import { AuditService } from '../audit/audit.service';
import { ExamStatus } from '@biddaloy/shared';

const TENANT_ID = 'tenant-1';
const EXAM_ID = 'exam-1';

async function buildService(
  opts: {
    examStatus?: ExamStatus;
    results?: any[];
    students?: any[];
    metered?: boolean;
    reserveOk?: boolean;
  } = {},
) {
  const {
    examStatus = ExamStatus.PUBLISHED,
    results = [{ student_id: 'stu-1', gpa: '4.00', grade: 'A', is_fail: false }],
    students = [
      {
        id: 'stu-1',
        full_name: 'Student One',
        guardians: [
          {
            id: 'g1',
            phone: '+8801700000000',
            full_name: 'Parent One',
            notifications_enabled: true,
          },
        ],
      },
    ],
    metered = false,
    reserveOk = true,
  } = opts;

  const examRepo: any = {
    findOne: vi.fn(async () => ({
      id: EXAM_ID,
      tenant_id: TENANT_ID,
      name: 'Term 1',
      status: examStatus,
    })),
  };
  const resultRepo: any = { find: vi.fn(async () => results) };
  const studentRepo: any = { find: vi.fn(async () => students) };
  const logRepo: any = {
    create: vi.fn((v: any) => v),
    save: vi.fn(async (v: any) => ({ id: `log-${Math.random()}`, ...v })),
  };
  const queue: any = { add: vi.fn(async () => undefined) };
  const smsCreditService = {
    isMetered: vi.fn(async () => metered),
    reserve: vi.fn(async () => (reserveOk ? { ok: true } : { ok: false, available: 0 })),
  };
  const auditService = { record: vi.fn(async () => undefined) };

  const moduleRef = await Test.createTestingModule({
    providers: [
      ResultSmsService,
      { provide: getRepositoryToken(Exam), useValue: examRepo },
      { provide: getRepositoryToken(Result), useValue: resultRepo },
      { provide: getRepositoryToken(Student), useValue: studentRepo },
      { provide: getRepositoryToken(CommunicationLog), useValue: logRepo },
      { provide: getQueueToken(COMMUNICATIONS_QUEUE), useValue: queue },
      { provide: SmsCreditService, useValue: smsCreditService },
      { provide: AuditService, useValue: auditService },
    ],
  }).compile();

  return {
    service: moduleRef.get(ResultSmsService),
    examRepo,
    resultRepo,
    studentRepo,
    logRepo,
    queue,
    smsCreditService,
    auditService,
  };
}

describe('ResultSmsService.sendForExam', () => {
  it('refuses to send for an unpublished exam', async () => {
    const { service } = await buildService({ examStatus: ExamStatus.PROCESSED });

    await expect(service.sendForExam(EXAM_ID, TENANT_ID, 'admin-1')).rejects.toThrow(
      ConflictException,
    );
  });

  it('sends one message per reachable guardian and audits the send', async () => {
    const { service, logRepo, queue, auditService } = await buildService();

    const outcome = await service.sendForExam(EXAM_ID, TENANT_ID, 'admin-1');

    expect(outcome.queued).toBe(1);
    expect(logRepo.save).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith('send', { logId: expect.any(String) });
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ new_values: expect.objectContaining({ queued: 1 }) }),
    );
  });

  it('skips a student with no reachable guardian', async () => {
    const { service } = await buildService({
      students: [{ id: 'stu-1', full_name: 'Student One', guardians: [] }],
    });

    const outcome = await service.sendForExam(EXAM_ID, TENANT_ID, 'admin-1');

    expect(outcome.queued).toBe(0);
    expect(outcome.skipped).toEqual([{ student_id: 'stu-1', reason: 'no_reachable_guardian' }]);
  });

  it('debits the credit ledger once per recipient when metered', async () => {
    const { service, smsCreditService } = await buildService({ metered: true });

    await service.sendForExam(EXAM_ID, TENANT_ID, 'admin-1');

    expect(smsCreditService.reserve).toHaveBeenCalledTimes(1);
    expect(smsCreditService.reserve).toHaveBeenCalledWith(
      TENANT_ID,
      1,
      `exam-result-sms:${EXAM_ID}`,
      {
        type: 'manual',
        id: EXAM_ID,
      },
    );
  });

  it('refuses to send when SMS credit is insufficient', async () => {
    const { service } = await buildService({ metered: true, reserveOk: false });

    await expect(service.sendForExam(EXAM_ID, TENANT_ID, 'admin-1')).rejects.toThrow(
      ConflictException,
    );
  });
});
