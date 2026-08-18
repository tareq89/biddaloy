import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bullmq';
import { CommunicationLog } from '../entities/communication-log.entity';
import { CommunicationStatus } from '@biddaloy/shared';
import { CommunicationProviderRegistryService } from '../providers/communication-provider.registry';
import { recordBatchOutcome, BatchOutcome } from '../reminder-batch-counters';
import { COMMUNICATIONS_QUEUE } from '../communications.constants';

interface SendJobData {
  logId: string;
}

/**
 * Consumer half of the communications module. Deliberately depends on
 * nothing outside this folder except the CommunicationLog repo and Redis
 * (via BullMQ) — see the plan's "Extraction recipe" for why: this class,
 * `providers/`, and `entities/communication-log.entity.ts` are the exact
 * set of files that would move into a standalone notification service.
 *
 * Retries are at-least-once, not exactly-once: a crash between a
 * provider's successful send and this method recording it could resend on
 * the next attempt (the log's status guard at the top of `process` catches
 * a *replay after that save landed*, but not a crash *before* it commits).
 * Full send-idempotency would need provider-side dedup keys, which aren't
 * uniformly available across these gateways, so this narrow window is an
 * accepted tradeoff rather than something this module solves. `settle`
 * saving the log and recording the batch outcome in one transaction is what
 * keeps that window from also being able to strand a batch in PROCESSING —
 * either both commit, or neither does and the retry goes through the
 * normal path again.
 */
@Processor(COMMUNICATIONS_QUEUE)
export class CommunicationsProcessor extends WorkerHost {
  constructor(
    @InjectRepository(CommunicationLog)
    private readonly repo: Repository<CommunicationLog>,
    private readonly providerRegistry: CommunicationProviderRegistryService,
  ) {
    super();
  }

  /**
   * Attributes a log's terminal outcome to its batch, if it has one.
   *
   * Only reached once the log will not be retried again — an intermediate
   * failure throws instead, so a message that eventually succeeds is
   * counted once, as a success.
   *
   * Runs the log save and the batch counter update in one transaction. If
   * they ran separately, a crash between them would leave a terminal log
   * whose outcome was never recorded — and the replay guard in `process`
   * would then skip it forever on retry, since it only checks whether the
   * log is already terminal, not whether its batch was updated. One
   * transaction means either both commit, or the log stays non-terminal
   * and a retry goes through the normal path again.
   */
  private async settle(log: CommunicationLog, outcome: BatchOutcome): Promise<void> {
    await this.repo.manager.transaction(async (manager) => {
      await manager.save(log);
      if (log.reminder_batch_id) {
        await recordBatchOutcome(manager, log.reminder_batch_id, outcome);
      }
    });
  }

  async process(job: Job<SendJobData>): Promise<void> {
    const log = await this.repo.findOneOrFail({ where: { id: job.data.logId } });

    // A BullMQ job can be reprocessed after it already reached a terminal
    // state — most commonly the "stalled job" recovery path, where a worker
    // that crashed or missed a lock-renewal deadline after settling the log
    // gets its job picked up again. Resending here would duplicate the
    // message to the guardian and double-count a batch that already
    // recorded this outcome, so a log that's already SENT/FAILED is treated
    // as done rather than reprocessed.
    if (log.status === CommunicationStatus.SENT || log.status === CommunicationStatus.FAILED) {
      return;
    }

    const provider = this.providerRegistry.resolve(log.medium);
    if (!provider) {
      // Not retryable — no deploy in between attempts will make a medium
      // suddenly have a provider.
      log.status = CommunicationStatus.FAILED;
      log.metadata = {
        ...log.metadata,
        error: `No provider registered for medium "${log.medium}"`,
      };
      await this.settle(log, 'failure');
      return;
    }

    const templateName = (log.metadata as { template_name?: string } | null)?.template_name;
    const templateLanguage = (log.metadata as { template_language?: string } | null)
      ?.template_language;
    const templateParams = (log.metadata as { template_params?: string[] } | null)?.template_params;

    // Providers are contractually not supposed to throw (see
    // CommunicationProvider) — this catch is defense-in-depth so a
    // provider bug still resolves to a normal failure result instead of
    // an unhandled rejection.
    let result;
    try {
      result = await provider.send(
        {
          to: log.recipient_address,
          body: log.message_body,
          subject: log.subject ?? undefined,
          templateName,
          templateLanguage,
          templateParams,
        },
        log.tenant_id,
      );
    } catch (err) {
      result = {
        success: false,
        providerMessageId: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    if (result.success) {
      log.status = CommunicationStatus.SENT;
      log.provider_message_id = result.providerMessageId;
      log.metadata = { ...log.metadata, raw: result.raw };
      await this.settle(log, 'success');
      return;
    }

    log.metadata = { ...log.metadata, error: result.error, raw: result.raw };

    const maxAttempts = job.opts.attempts ?? 1;
    const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts;
    // `retryable === false` means the provider itself says retrying can
    // never help (e.g. ProviderNotConfiguredError) — settle FAILED on the
    // first attempt instead of burning the rest of the queue's backoff
    // budget on a failure that will be identical every time.
    if (isFinalAttempt || result.retryable === false) {
      log.status = CommunicationStatus.FAILED;
      await this.settle(log, 'failure');
      return;
    }

    // Keep the row QUEUED with the latest failure recorded, then throw so
    // BullMQ's configured attempts/backoff actually retries the job —
    // returning normally here would mark the job "completed" even though
    // the send failed.
    await this.repo.save(log);
    throw new Error(result.error ?? `Provider failed to send communication ${log.id}`);
  }
}
