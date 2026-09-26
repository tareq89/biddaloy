import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { AdmissionApplicantStatus, CommunicationMedium, CommunicationStatus, CommunicationTrigger } from '@biddaloy/shared';
import { AdmissionNotificationService } from './admission-notification.service';
import { CommunicationLog } from '../communications/entities/communication-log.entity';
import { COMMUNICATIONS_QUEUE } from '../communications/communications.constants';

/**
 * [27.7] Unit coverage: correct SMS template per status, queued via the
 * existing `COMMUNICATIONS_QUEUE` mechanism (mocked queue, asserted job
 * payload) — mirrors `AbsenceNoticeService`'s existing spec shape for the
 * same producer pattern.
 */
describe('AdmissionNotificationService', () => {
  let service: AdmissionNotificationService;
  let logRepo: { create: ReturnType<typeof vi.fn>; save: ReturnType<typeof vi.fn> };
  let queue: { add: ReturnType<typeof vi.fn> };

  const applicant = {
    id: 'applicant-1',
    tenant_id: 'tenant-a',
    applicant_name: 'Rahim Uddin',
    guardian_name: 'Karim Uddin',
    guardian_phone: '01700000000',
    status: AdmissionApplicantStatus.PENDING,
  };

  beforeEach(async () => {
    logRepo = {
      create: vi.fn((dto) => dto),
      save: vi.fn(async (log) => ({ ...log, id: 'log-1' })),
    };
    queue = { add: vi.fn(async () => undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AdmissionNotificationService,
        { provide: getRepositoryToken(CommunicationLog), useValue: logRepo },
        { provide: getQueueToken(COMMUNICATIONS_QUEUE), useValue: queue },
      ],
    }).compile();

    service = moduleRef.get(AdmissionNotificationService);
  });

  it('queues an SMS with the SHORTLISTED template', async () => {
    await service.notifyStatusChange(
      { ...applicant, status: AdmissionApplicantStatus.SHORTLISTED },
      'Class 1 Admission',
    );

    expect(logRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: 'tenant-a',
        medium: CommunicationMedium.SMS,
        recipient_address: '01700000000',
        status: CommunicationStatus.QUEUED,
        trigger: CommunicationTrigger.AUTOMATED,
        message_body: expect.stringContaining('shortlisted'),
      }),
    );
    expect(logRepo.save.mock.calls[0][0].message_body).toContain('Class 1 Admission');
    expect(queue.add).toHaveBeenCalledWith('send', { logId: 'log-1' });
  });

  it('queues an SMS with the ADMITTED template', async () => {
    await service.notifyStatusChange(
      { ...applicant, status: AdmissionApplicantStatus.ADMITTED },
      'Class 1 Admission',
    );
    expect(logRepo.save.mock.calls[0][0].message_body).toContain('admitted');
  });

  it('queues an SMS with the REJECTED template', async () => {
    await service.notifyStatusChange(
      { ...applicant, status: AdmissionApplicantStatus.REJECTED },
      'Class 1 Admission',
    );
    expect(logRepo.save.mock.calls[0][0].message_body).toContain('not successful');
  });

  it('does nothing for PENDING (not a notifiable status)', async () => {
    await service.notifyStatusChange(applicant, 'Class 1 Admission');
    expect(logRepo.save).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('marks the log FAILED when enqueueing throws, without rejecting', async () => {
    queue.add.mockRejectedValueOnce(new Error('queue down'));
    await service.notifyStatusChange(
      { ...applicant, status: AdmissionApplicantStatus.ADMITTED },
      'Class 1 Admission',
    );
    expect(logRepo.save).toHaveBeenCalledTimes(2);
    expect(logRepo.save.mock.calls[1][0].status).toBe(CommunicationStatus.FAILED);
  });
});
