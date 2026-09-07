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
  function job(overrides: { attemptsMade?: number; attempts?: number } = {}) {
    return {
      data: { logId: 'log-1' },
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

    processor = new CommunicationsProcessor(
      repo as any,
      providerRegistry as any,
      tenantStatus as any,
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
