import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CommunicationsProcessor } from './communications.processor';
import { CommunicationMedium, CommunicationStatus } from '@biddaloy/shared';

// [15.1.4] captureException/captureMessage/withScope are spied so onFailed/
// onStalled tests can assert exactly what reaches Sentry without a real DSN.
const sentryCaptureException = vi.fn();
const sentryCaptureMessage = vi.fn();
const sentrySetTags = vi.fn();
vi.mock('@sentry/node', () => ({
  withScope: (cb: (scope: { setTags: typeof sentrySetTags }) => void) =>
    cb({ setTags: sentrySetTags }),
  captureException: (...args: unknown[]) => sentryCaptureException(...args),
  captureMessage: (...args: unknown[]) => sentryCaptureMessage(...args),
}));

describe('CommunicationsProcessor', () => {
  let processor: CommunicationsProcessor;
  let repo: Record<string, ReturnType<typeof vi.fn>>;
  let txManager: Record<string, ReturnType<typeof vi.fn>>;
  let providerRegistry: Record<string, ReturnType<typeof vi.fn>>;
  let provider: Record<string, ReturnType<typeof vi.fn>>;
  let tenantStatus: Record<string, ReturnType<typeof vi.fn>>;
  let smsCredits: Record<string, ReturnType<typeof vi.fn>>;

  const baseLog = {
    id: 'log-1',
    tenant_id: 'tenant-1',
    medium: CommunicationMedium.SMS,
    recipient_address: '01712345678',
    message_body: 'Hello',
    subject: null,
    metadata: null,
    status: CommunicationStatus.QUEUED,
    reminder_batch_id: null,
  };

  // attemptsMade: 0 with attempts: 3 means "first attempt, two retries left".
  function job(
    overrides: {
      attemptsMade?: number;
      attempts?: number;
      batchId?: string;
      segments?: number;
    } = {},
  ) {
    return {
      name: undefined,
      data: {
        logId: 'log-1',
        ...(overrides.batchId !== undefined ? { batchId: overrides.batchId } : {}),
        ...(overrides.segments !== undefined ? { segments: overrides.segments } : {}),
      },
      attemptsMade: overrides.attemptsMade ?? 0,
      opts: { attempts: overrides.attempts ?? 3 },
    } as any;
  }

  beforeEach(() => {
    provider = { send: vi.fn() };
    // A terminal outcome (SENT/FAILED) is settled inside repo.manager.transaction
    // so the log save and the batch counter update commit or roll back
    // together — see settle()'s doc comment for why. txManager stands in for
    // the transactional EntityManager the callback receives.
    txManager = {
      save: vi.fn(async (log) => log),
      query: vi.fn(async () => undefined),
    };
    repo = {
      findOneOrFail: vi.fn(async () => ({ ...baseLog })),
      findOne: vi.fn(async () => ({ ...baseLog })),
      save: vi.fn(async (log) => log),
      manager: { transaction: vi.fn(async (cb: any) => cb(txManager)) },
    };
    providerRegistry = { resolve: vi.fn(() => provider) };
    // #528: defaults to "active" so the existing send/failure/retry tests
    // below don't have to know about tenant suspension at all.
    tenantStatus = { isActive: vi.fn(async () => true) };
    // [15.6.6/#549] Settlement's own idempotency is proven at the service
    // level (#546's integration spec) — this mock just records the calls
    // so the processor's dispatch logic (which outcome maps to which
    // settlePart call, or none) can be asserted here.
    smsCredits = { settlePart: vi.fn(async () => undefined) };

    processor = new CommunicationsProcessor(
      repo as any,
      providerRegistry as any,
      tenantStatus as any,
      smsCredits as any,
    );

    sentryCaptureException.mockClear();
    sentryCaptureMessage.mockClear();
    sentrySetTags.mockClear();
  });

  /** Params passed to recordBatchOutcome's single UPDATE: [batchId, +success, +failure]. */
  function batchUpdateParams() {
    return txManager.query.mock.calls[0][1] as [string, number, number];
  }

  it('marks the log SENT with the provider message id on success', async () => {
    provider.send.mockResolvedValue({ success: true, providerMessageId: 'p-1', raw: { ok: true } });

    await processor.process(job());

    expect(txManager.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: CommunicationStatus.SENT, provider_message_id: 'p-1' }),
    );
  });

  // [15.6.1] `result.segments` (from the shared `countSmsSegments` via the
  // SMS gateways) lands on `metadata.segments` — exact count, not just
  // "present" — for both a successful and a failed send.
  it('writes the provider segment count onto metadata.segments on success', async () => {
    provider.send.mockResolvedValue({
      success: true,
      providerMessageId: 'p-2',
      raw: { ok: true },
      segments: 1,
    });

    await processor.process(job());

    expect(txManager.save).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ segments: 1 }) }),
    );
  });

  it('writes the provider segment count onto metadata.segments on a retryable failure', async () => {
    provider.send.mockResolvedValue({
      success: false,
      providerMessageId: null,
      error: 'gateway down',
      segments: 3,
    });

    await expect(processor.process(job({ attemptsMade: 0, attempts: 3 }))).rejects.toThrow();

    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ segments: 3 }) }),
    );
  });

  it('records the failure and throws to trigger a BullMQ retry when attempts remain', async () => {
    provider.send.mockResolvedValue({
      success: false,
      providerMessageId: null,
      error: 'gateway down',
    });

    await expect(processor.process(job({ attemptsMade: 0, attempts: 3 }))).rejects.toThrow(
      'gateway down',
    );

    // Still QUEUED — only the metadata records the latest failed attempt.
    // Not a terminal outcome, so this goes through repo.save directly, not
    // the transactional settle() path.
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: CommunicationStatus.QUEUED,
        metadata: expect.objectContaining({ error: 'gateway down' }),
      }),
    );
    expect(txManager.save).not.toHaveBeenCalled();
  });

  it('marks the log FAILED without throwing once retries are exhausted', async () => {
    provider.send.mockResolvedValue({
      success: false,
      providerMessageId: null,
      error: 'gateway down',
    });

    await expect(processor.process(job({ attemptsMade: 2, attempts: 3 }))).resolves.toBeUndefined();

    expect(txManager.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: CommunicationStatus.FAILED,
        metadata: expect.objectContaining({ error: 'gateway down' }),
      }),
    );
  });

  it('marks the log FAILED on the first attempt when the provider says the failure is not retryable', async () => {
    // A ProviderNotConfiguredError sets retryable: false — retrying it
    // three times just delays a failure that's identical every attempt.
    provider.send.mockResolvedValue({
      success: false,
      providerMessageId: null,
      error: 'WhatsApp is not configured for this tenant',
      retryable: false,
    });

    await expect(processor.process(job({ attemptsMade: 0, attempts: 3 }))).resolves.toBeUndefined();

    expect(txManager.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: CommunicationStatus.FAILED,
        metadata: expect.objectContaining({ error: 'WhatsApp is not configured for this tenant' }),
      }),
    );
    // Settled directly — never went through the "keep QUEUED and throw to
    // retry" path a transient failure would.
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('marks the log FAILED without throwing when no provider is registered for the medium', async () => {
    providerRegistry.resolve.mockReturnValue(undefined);

    await expect(processor.process(job())).resolves.toBeUndefined();

    expect(provider.send).not.toHaveBeenCalled();
    expect(txManager.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: CommunicationStatus.FAILED }),
    );
  });

  it('converts a provider throw into a failure result instead of crashing (defense-in-depth)', async () => {
    provider.send.mockRejectedValue(new Error('unexpected provider bug'));

    await expect(processor.process(job({ attemptsMade: 2, attempts: 3 }))).resolves.toBeUndefined();

    expect(txManager.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: CommunicationStatus.FAILED,
        metadata: expect.objectContaining({ error: 'unexpected provider bug' }),
      }),
    );
  });

  it('passes template fields from metadata through to the provider', async () => {
    repo.findOneOrFail.mockResolvedValue({
      ...baseLog,
      medium: CommunicationMedium.WHATSAPP,
      metadata: {
        template_name: 'fee_reminder',
        template_language: 'bn',
        template_params: ['500'],
      },
    });
    provider.send.mockResolvedValue({ success: true, providerMessageId: 'wa-1' });

    await processor.process(job());

    expect(provider.send).toHaveBeenCalledWith(
      expect.objectContaining({
        templateName: 'fee_reminder',
        templateLanguage: 'bn',
        templateParams: ['500'],
      }),
      'tenant-1',
    );
  });

  describe('reminder batch attribution', () => {
    function batchLog(overrides: Record<string, unknown> = {}) {
      repo.findOneOrFail.mockResolvedValue({
        ...baseLog,
        reminder_batch_id: 'batch-1',
        ...overrides,
      });
    }

    it('counts a delivered message as a batch success', async () => {
      batchLog();
      provider.send.mockResolvedValue({ success: true, providerMessageId: 'p-1' });

      await processor.process(job());

      expect(batchUpdateParams()).toEqual(['batch-1', 1, 0]);
    });

    it('counts a permanently failed message as a batch failure', async () => {
      batchLog();
      provider.send.mockResolvedValue({
        success: false,
        providerMessageId: null,
        error: 'gateway down',
      });

      await processor.process(job({ attemptsMade: 2, attempts: 3 }));

      expect(batchUpdateParams()).toEqual(['batch-1', 0, 1]);
    });

    it('counts an unroutable medium as a batch failure', async () => {
      batchLog();
      providerRegistry.resolve.mockReturnValue(undefined);

      await processor.process(job());

      expect(batchUpdateParams()).toEqual(['batch-1', 0, 1]);
    });

    it('does not count a retryable failure, since the message may still succeed', async () => {
      batchLog();
      provider.send.mockResolvedValue({
        success: false,
        providerMessageId: null,
        error: 'gateway down',
      });

      await expect(processor.process(job({ attemptsMade: 0, attempts: 3 }))).rejects.toThrow();

      expect(repo.manager.transaction).not.toHaveBeenCalled();
    });

    it('leaves the batch untouched for a one-off send with no batch', async () => {
      provider.send.mockResolvedValue({ success: true, providerMessageId: 'p-1' });

      await processor.process(job());

      expect(txManager.save).toHaveBeenCalled();
      expect(txManager.query).not.toHaveBeenCalled();
    });

    it('saves the log and records the batch outcome in the same transaction', async () => {
      // The point of the transaction: a crash between saving the log and
      // recording the batch outcome must not be possible, since the replay
      // guard would then skip a terminal log forever without ever counting
      // it. Asserting both happened inside the one callback given to
      // repo.manager.transaction is what actually verifies that, rather
      // than just checking each write happened somewhere.
      batchLog();
      provider.send.mockResolvedValue({ success: true, providerMessageId: 'p-1' });

      await processor.process(job());

      expect(repo.manager.transaction).toHaveBeenCalledTimes(1);
      expect(txManager.save).toHaveBeenCalledTimes(1);
      expect(txManager.query).toHaveBeenCalledTimes(1);
    });
  });

  describe('replay protection', () => {
    // BullMQ's stalled-job recovery can hand the same job to a worker again
    // after a previous run already saved a terminal outcome. Reprocessing it
    // would resend the message and double-count the batch, so a log that's
    // already SENT or FAILED short-circuits instead.
    it('does not resend or resave a log that already settled as SENT', async () => {
      repo.findOneOrFail.mockResolvedValue({ ...baseLog, status: CommunicationStatus.SENT });

      await processor.process(job());

      expect(provider.send).not.toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
      expect(repo.manager.transaction).not.toHaveBeenCalled();
    });

    it('does not resend or resave a log that already settled as FAILED', async () => {
      repo.findOneOrFail.mockResolvedValue({ ...baseLog, status: CommunicationStatus.FAILED });

      await processor.process(job());

      expect(provider.send).not.toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
      expect(repo.manager.transaction).not.toHaveBeenCalled();
    });

    it('does not double-count a batch when a settled log is replayed', async () => {
      repo.findOneOrFail.mockResolvedValue({
        ...baseLog,
        status: CommunicationStatus.SENT,
        reminder_batch_id: 'batch-1',
      });

      await processor.process(job());

      expect(txManager.query).not.toHaveBeenCalled();
    });

    it('still processes a QUEUED log normally', async () => {
      provider.send.mockResolvedValue({ success: true, providerMessageId: 'p-1' });

      await processor.process(job());

      expect(provider.send).toHaveBeenCalledTimes(1);
    });

    // A worker can commit settle() and then crash/lose its lock before
    // settleSmsCredit runs — the replayed job must resume settlement
    // instead of leaving the reservation stuck forever (#570).
    it('resumes a DEBIT settlement for a terminal SENT log replayed with no recorded credit', async () => {
      repo.findOneOrFail.mockResolvedValue({ ...baseLog, status: CommunicationStatus.SENT });

      await processor.process(job({ batchId: 'batch-1', segments: 2 }));

      expect(provider.send).not.toHaveBeenCalled();
      expect(smsCredits.settlePart).toHaveBeenCalledWith(
        'tenant-1',
        'batch:batch-1',
        'log:log-1',
        2,
        'DEBIT',
      );
    });

    it('resumes a RELEASE settlement for a terminal FAILED log replayed with no recorded credit', async () => {
      repo.findOneOrFail.mockResolvedValue({ ...baseLog, status: CommunicationStatus.FAILED });

      await processor.process(job({ batchId: 'batch-1', segments: 2 }));

      expect(provider.send).not.toHaveBeenCalled();
      expect(smsCredits.settlePart).toHaveBeenCalledWith(
        'tenant-1',
        'batch:batch-1',
        'log:log-1',
        2,
        'RELEASE',
      );
    });

    it('does not resume settlement for a terminal log that already recorded a credit disposition', async () => {
      repo.findOneOrFail.mockResolvedValue({
        ...baseLog,
        status: CommunicationStatus.FAILED,
        metadata: { credit: 'UNSETTLED' },
      });

      await processor.process(job({ batchId: 'batch-1', segments: 2 }));

      expect(smsCredits.settlePart).not.toHaveBeenCalled();
    });
  });

  describe('tenant suspension [528]', () => {
    it('fails the log with TENANT_SUSPENDED and never calls the provider when the tenant is suspended', async () => {
      tenantStatus.isActive.mockResolvedValue(false);

      await expect(processor.process(job())).resolves.toBeUndefined();

      expect(provider.send).not.toHaveBeenCalled();
      expect(txManager.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: CommunicationStatus.FAILED,
          metadata: expect.objectContaining({ reason: 'TENANT_SUSPENDED' }),
        }),
      );
    });

    it('leaves an already-SENT log untouched on replay even when the tenant is now suspended', async () => {
      // A stalled-job replay of a log that settled as SENT before the school
      // was suspended must not be rewritten to FAILED — that would record a
      // second batch outcome for the same message.
      tenantStatus.isActive.mockResolvedValue(false);
      repo.findOneOrFail.mockResolvedValue({
        ...baseLog,
        status: CommunicationStatus.SENT,
        reminder_batch_id: 'batch-1',
      });

      await processor.process(job());

      expect(tenantStatus.isActive).not.toHaveBeenCalled();
      expect(repo.manager.transaction).not.toHaveBeenCalled();
      expect(txManager.save).not.toHaveBeenCalled();
      expect(txManager.query).not.toHaveBeenCalled();
    });
  });

  describe('sms credit settlement [15.6.6/#549]', () => {
    // These SMS-batch jobs carry batchId + segments — the two fields that
    // make a job "settleable" per SmsCreditService.settlePart's contract.
    function smsBatchJob(overrides: Parameters<typeof job>[0] = {}) {
      return job({ batchId: 'batch-1', segments: 2, ...overrides });
    }

    it('ACCEPTED debits the batch reservation and records metadata.credit = DEBITED', async () => {
      provider.send.mockResolvedValue({
        success: true,
        providerMessageId: 'p-1',
        outcome: 'ACCEPTED',
        segments: 2,
      });

      await processor.process(smsBatchJob());

      expect(smsCredits.settlePart).toHaveBeenCalledWith(
        'tenant-1',
        'batch:batch-1',
        'log:log-1',
        2,
        'DEBIT',
      );
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: expect.objectContaining({ credit: 'DEBITED' }) }),
      );
    });

    it('REJECTED releases the batch reservation and records metadata.credit = RELEASED', async () => {
      provider.send.mockResolvedValue({
        success: false,
        providerMessageId: null,
        error: 'invalid number',
        outcome: 'REJECTED',
        segments: 2,
        retryable: false,
      });

      await processor.process(smsBatchJob());

      expect(smsCredits.settlePart).toHaveBeenCalledWith(
        'tenant-1',
        'batch:batch-1',
        'log:log-1',
        2,
        'RELEASE',
      );
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: expect.objectContaining({ credit: 'RELEASED' }) }),
      );
    });

    it('AMBIGUOUS never settles, flags metadata.credit = UNSETTLED, and tags Sentry with needs_reconciliation', async () => {
      provider.send.mockResolvedValue({
        success: false,
        providerMessageId: null,
        error: 'timeout',
        outcome: 'AMBIGUOUS',
        segments: 2,
        retryable: false,
      });

      await processor.process(smsBatchJob());

      expect(smsCredits.settlePart).not.toHaveBeenCalled();
      expect(txManager.save).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: expect.objectContaining({ credit: 'UNSETTLED' }) }),
      );
      expect(sentrySetTags).toHaveBeenCalledWith(
        expect.objectContaining({ needs_reconciliation: 'true', communication_log_id: 'log-1' }),
      );
      expect(sentryCaptureMessage).toHaveBeenCalledWith(
        'sms send outcome ambiguous — needs reconciliation',
        'warning',
      );
    });

    it('a settlePart failure flags UNSETTLED and reports the same needs_reconciliation Sentry tag', async () => {
      provider.send.mockResolvedValue({ success: true, providerMessageId: 'p-1', segments: 2 });
      const settleError = new Error('no RESERVE found for batch key');
      smsCredits.settlePart.mockRejectedValueOnce(settleError);

      await processor.process(smsBatchJob());

      expect(txManager.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: CommunicationStatus.SENT }),
      );
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: expect.objectContaining({ credit: 'UNSETTLED' }) }),
      );
      expect(sentrySetTags).toHaveBeenCalledWith(
        expect.objectContaining({ needs_reconciliation: 'true', communication_log_id: 'log-1' }),
      );
      expect(sentryCaptureException).toHaveBeenCalledWith(settleError);
    });

    it('a suspended tenant releases the reservation instead of leaving it stuck', async () => {
      tenantStatus.isActive.mockResolvedValue(false);

      await processor.process(smsBatchJob());

      expect(provider.send).not.toHaveBeenCalled();
      expect(smsCredits.settlePart).toHaveBeenCalledWith(
        'tenant-1',
        'batch:batch-1',
        'log:log-1',
        2,
        'RELEASE',
      );
    });

    it('re-running the same job settles under the same stable log:<id> key', async () => {
      provider.send.mockResolvedValue({
        success: true,
        providerMessageId: 'p-1',
        outcome: 'ACCEPTED',
        segments: 2,
      });

      await processor.process(smsBatchJob());
      // A second run of the identical job (e.g. stalled-job recovery before
      // the log's status flips to SENT) must call settlePart with the exact
      // same logKey — that's what makes SmsCreditService's own idempotency
      // check (proven in #546's integration spec) actually apply here.
      await processor.process(smsBatchJob());

      const keys = smsCredits.settlePart.mock.calls.map((call) => call[2]);
      expect(keys).toEqual(['log:log-1', 'log:log-1']);
    });

    it('does not settle a non-SMS medium even with batchId/segments present', async () => {
      repo.findOneOrFail.mockResolvedValue({ ...baseLog, medium: CommunicationMedium.EMAIL });
      provider.send.mockResolvedValue({
        success: true,
        providerMessageId: 'p-1',
        outcome: 'ACCEPTED',
      });

      await processor.process(smsBatchJob());

      expect(smsCredits.settlePart).not.toHaveBeenCalled();
    });

    it('does not settle an SMS job with no batchId (single reminder / notification)', async () => {
      provider.send.mockResolvedValue({
        success: true,
        providerMessageId: 'p-1',
        outcome: 'ACCEPTED',
        segments: 1,
      });

      await processor.process(job({ segments: 1 }));

      expect(smsCredits.settlePart).not.toHaveBeenCalled();
    });

    it('does not settle an SMS batch job with no segments count', async () => {
      provider.send.mockResolvedValue({
        success: true,
        providerMessageId: 'p-1',
        outcome: 'ACCEPTED',
      });

      await processor.process(job({ batchId: 'batch-1' }));

      expect(smsCredits.settlePart).not.toHaveBeenCalled();
    });
  });

  describe('onFailed / onStalled telemetry [15.1.4]', () => {
    it('reports a final-attempt failure to Sentry with ids only, no recipient/message', async () => {
      const err = new Error('provider rejected');
      await processor.onFailed(job({ attemptsMade: 3, attempts: 3 }), err);

      expect(sentrySetTags).toHaveBeenCalledWith({
        queue: 'communications',
        job_name: undefined,
        communication_log_id: 'log-1',
        tenant_id: 'tenant-1',
        medium: CommunicationMedium.SMS,
      });
      expect(sentryCaptureException).toHaveBeenCalledWith(err);

      const serialized = JSON.stringify(sentrySetTags.mock.calls[0][0]);
      expect(serialized).not.toContain(baseLog.recipient_address);
      expect(serialized).not.toContain(baseLog.message_body);
    });

    it('does not report a non-final failure', async () => {
      await processor.onFailed(job({ attemptsMade: 1, attempts: 3 }), new Error('transient'));

      expect(sentryCaptureException).not.toHaveBeenCalled();
    });

    it('does nothing when BullMQ passes no job', async () => {
      await processor.onFailed(undefined, new Error('x'));

      expect(sentryCaptureException).not.toHaveBeenCalled();
    });

    it('reports a stalled job as a warning message with ids only', async () => {
      await processor.onStalled('log-1');

      expect(sentrySetTags).toHaveBeenCalledWith({
        queue: 'communications',
        communication_log_id: 'log-1',
        tenant_id: 'tenant-1',
        medium: CommunicationMedium.SMS,
      });
      expect(sentryCaptureMessage).toHaveBeenCalledWith('communications job stalled', 'warning');

      const serialized = JSON.stringify(sentrySetTags.mock.calls[0][0]);
      expect(serialized).not.toContain(baseLog.recipient_address);
      expect(serialized).not.toContain(baseLog.message_body);
    });
  });
});
