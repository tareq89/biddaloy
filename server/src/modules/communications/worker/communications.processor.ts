import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bullmq';
import { CommunicationLog } from '../entities/communication-log.entity';
import { CommunicationStatus } from '@beton-boi/shared';
import { CommunicationProviderRegistryService } from '../providers/communication-provider.registry';
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
 * Re-running process() for a retried job is safe — it just re-sends and
 * re-writes the same log row.
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

  async process(job: Job<SendJobData>): Promise<void> {
    const log = await this.repo.findOneOrFail({ where: { id: job.data.logId } });

    const provider = this.providerRegistry.resolve(log.medium);
    if (!provider) {
      log.status = CommunicationStatus.FAILED;
      log.metadata = { ...log.metadata, error: `No provider registered for medium "${log.medium}"` };
      await this.repo.save(log);
      return;
    }

    const templateName = (log.metadata as { template_name?: string } | null)?.template_name;
    const templateLanguage = (log.metadata as { template_language?: string } | null)?.template_language;
    const templateParams = (log.metadata as { template_params?: string[] } | null)?.template_params;

    const result = await provider.send({
      to: log.recipient_address,
      body: log.message_body,
      subject: log.subject ?? undefined,
      templateName,
      templateLanguage,
      templateParams,
    });

    log.status = result.success ? CommunicationStatus.SENT : CommunicationStatus.FAILED;
    log.provider_message_id = result.providerMessageId;
    log.metadata = { ...log.metadata, ...(result.error ? { error: result.error } : {}), raw: result.raw };
    await this.repo.save(log);
  }
}
