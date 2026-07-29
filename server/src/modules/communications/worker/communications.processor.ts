import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bullmq';
import { CommunicationLog } from '../entities/communication-log.entity';
import { ReminderBatch } from '../entities/reminder-batch.entity';
import { CommunicationStatus } from '@beton-boi/shared';
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
 * the next attempt. Full send-idempotency would need provider-side
 * dedup keys, which aren't uniformly available across these gateways, so
 * this is an accepted tradeoff rather than something this module solves.
 */
@Processor(COMMUNICATIONS_QUEUE)
export class CommunicationsProcessor extends WorkerHost {
  constructor(
    @InjectRepository(CommunicationLog)
    private readonly repo: Repository<CommunicationLog>,
    @InjectRepository(ReminderBatch)
    private readonly batchRepo: Repository<ReminderBatch>,
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
   */
  private async settle(log: CommunicationLog, outcome: BatchOutcome): Promise<void> {
    await this.repo.save(log);
    if (log.reminder_batch_id) {
      await recordBatchOutcome(this.batchRepo, log.reminder_batch_id, outcome);
    }
  }

  async process(job: Job<SendJobData>): Promise<void> {
    const log = await this.repo.findOneOrFail({ where: { id: job.data.logId } });

    const provider = this.providerRegistry.resolve(log.medium);
    if (!provider) {
      // Not retryable — no deploy in between attempts will make a medium
      // suddenly have a provider.
      log.status = CommunicationStatus.FAILED;
      log.metadata = { ...log.metadata, error: `No provider registered for medium "${log.medium}"` };
      await this.settle(log, 'failure');
      return;
    }

    const templateName = (log.metadata as { template_name?: string } | null)?.template_name;
    const templateLanguage = (log.metadata as { template_language?: string } | null)?.template_language;
    const templateParams = (log.metadata as { template_params?: string[] } | null)?.template_params;

    // Providers are contractually not supposed to throw (see
    // CommunicationProvider) — this catch is defense-in-depth so a
    // provider bug still resolves to a normal failure result instead of
    // an unhandled rejection.
    let result;
    try {
      result = await provider.send({
        to: log.recipient_address,
        body: log.message_body,
        subject: log.subject ?? undefined,
        templateName,
        templateLanguage,
        templateParams,
      });
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
    if (isFinalAttempt) {
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
