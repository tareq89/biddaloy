import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { AdmissionApplicantStatus, AdmissionFeeState } from '@biddaloy/shared';
import { AdmissionFeeService } from './admission-fee.service';
import { AdmissionApplicant } from './entities/admission-applicant.entity';
import { AdmissionFeeProof } from './entities/admission-fee-proof.entity';
import { AdmissionIntake } from './entities/admission-intake.entity';

const T = 'tenant-a';
const actor = { userId: 'staff-1', ip: '1.2.3.4', userAgent: 'ua' };

describe('AdmissionFeeService', () => {
  let proof: Partial<AdmissionFeeProof>;
  let applicant: Partial<AdmissionApplicant>;
  let events: string[];
  let manager: {
    findOne: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    transaction?: unknown;
  };
  let audit: { record: ReturnType<typeof vi.fn> };
  let notifications: { notifyFeeSentBack: ReturnType<typeof vi.fn> };
  let service: AdmissionFeeService;

  beforeEach(() => {
    proof = { id: 'p1', tenant_id: T, applicant_id: 'a1', state: AdmissionFeeState.AWAITING };
    applicant = {
      id: 'a1',
      tenant_id: T,
      intake_id: 'i1',
      status: AdmissionApplicantStatus.FEE_PENDING,
      fee_state: AdmissionFeeState.AWAITING,
    };
    events = [];
    manager = {
      findOne: vi.fn(
        async (entity: unknown, opts: { where: { id: string; tenant_id: string } }) => {
          if (opts.where.tenant_id !== T) return null;
          if (entity === AdmissionFeeProof) return opts.where.id === 'p1' ? proof : null;
          if (entity === AdmissionApplicant) return applicant;
          if (entity === AdmissionIntake) return { id: 'i1', title: 'Class One' };
          return null;
        },
      ),
      save: vi.fn(async (e: unknown) => e),
    };
    manager.transaction = async (cb: (m: unknown) => Promise<unknown>) => {
      events.push('begin');
      const out = await cb(manager);
      events.push('commit');
      return out;
    };
    audit = { record: vi.fn(async () => undefined) };
    notifications = {
      notifyFeeSentBack: vi.fn(async () => {
        events.push('notify');
      }),
    };
    service = new AdmissionFeeService(
      { manager } as never,
      {} as never,
      audit as never,
      notifications as never,
    );
  });

  it('confirm moves the applicant to PENDING, stamps the verifier and audits on the applicant', async () => {
    const out = await service.confirm('p1', T, actor);
    expect(out).toMatchObject({ fee_state: 'CONFIRMED', status: 'PENDING' });
    expect(proof).toMatchObject({ state: 'CONFIRMED', verified_by_user_id: 'staff-1' });
    expect(applicant.status).toBe(AdmissionApplicantStatus.PENDING);
    const [row, mgr] = audit.record.mock.calls[0];
    expect(mgr).toBe(manager);
    expect(row).toMatchObject({
      entity_type: 'AdmissionApplicant',
      entity_id: 'a1',
      tenant_id: T,
      performed_by_user_id: 'staff-1',
      old_values: { fee_state: 'AWAITING' },
      new_values: { fee_state: 'CONFIRMED', proof_id: 'p1' },
    });
  });

  it('locks proof and applicant for write', async () => {
    await service.confirm('p1', T, actor);
    for (const [, opts] of manager.findOne.mock.calls) {
      expect(opts.lock).toEqual({ mode: 'pessimistic_write' });
    }
  });

  it('a second confirm gives 409 and writes nothing', async () => {
    await service.confirm('p1', T, actor);
    manager.save.mockClear();
    audit.record.mockClear();
    await expect(service.confirm('p1', T, actor)).rejects.toBeInstanceOf(ConflictException);
    expect(manager.save).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('confirm of an applicant no longer FEE_PENDING gives 409', async () => {
    applicant.status = AdmissionApplicantStatus.REJECTED;
    await expect(service.confirm('p1', T, actor)).rejects.toBeInstanceOf(ConflictException);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('another tenant or an unknown proof is 404', async () => {
    await expect(service.confirm('p1', 'tenant-b', actor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.confirm('nope', T, actor)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('send back keeps FEE_PENDING, stores the reason, audits it, and notifies after commit', async () => {
    const out = await service.sendBack('p1', T, 'Blurry screenshot', actor);
    expect(out).toMatchObject({ fee_state: 'SENT_BACK', status: 'FEE_PENDING' });
    expect(proof).toMatchObject({ state: 'SENT_BACK', reason: 'Blurry screenshot' });
    expect(applicant.status).toBe(AdmissionApplicantStatus.FEE_PENDING);
    expect(audit.record.mock.calls[0][0].new_values).toEqual({
      fee_state: 'SENT_BACK',
      proof_id: 'p1',
      reason: 'Blurry screenshot',
    });
    expect(notifications.notifyFeeSentBack).toHaveBeenCalledWith(
      applicant,
      'Class One',
      'Blurry screenshot',
    );
    expect(events).toEqual(['begin', 'commit', 'notify']);
  });

  it('a send-back of a decided proof is 409 and tells nobody', async () => {
    proof.state = AdmissionFeeState.CONFIRMED;
    await expect(service.sendBack('p1', T, 'x', actor)).rejects.toBeInstanceOf(ConflictException);
    expect(notifications.notifyFeeSentBack).not.toHaveBeenCalled();
  });

  it('a failing notification does not undo the decision', async () => {
    notifications.notifyFeeSentBack.mockRejectedValue(new Error('queue down'));
    await expect(service.sendBack('p1', T, 'r', actor)).resolves.toMatchObject({
      fee_state: 'SENT_BACK',
    });
  });
});
