import { DataSource } from 'typeorm';
import { Job } from 'bullmq';
import { CommunicationLog } from '../../src/modules/communications/entities/communication-log.entity';
import { Guardian } from '../../src/modules/students/entities/guardian.entity';
import { SmsCreditService } from '../../src/modules/communications/credits/sms-credit.service';
import { SmsCreditBalance } from '../../src/modules/communications/credits/entities/sms-credit-balance.entity';
import { SmsCreditLedger } from '../../src/modules/communications/credits/entities/sms-credit-ledger.entity';
import { CommunicationsProcessor } from '../../src/modules/communications/worker/communications.processor';

/**
 * Shared harness for the #1317 integration specs: a real `SmsCreditService`
 * (PLATFORM-metered) plus a real `CommunicationsProcessor` over the real
 * ledger, so each producer's reserve key is proven against what the worker
 * actually settles under, not just asserted as a string.
 */
export function makeMeteredCreditService(dataSource: DataSource): SmsCreditService {
  return new SmsCreditService(
    dataSource.getRepository(SmsCreditBalance),
    dataSource.getRepository(SmsCreditLedger),
    dataSource,
    {
      getResolvedSettings: async () => ({
        communications: { sms: { metering: 'PLATFORM', provider: 'test' } },
        region: { locale: 'en-US' },
      }),
    } as any,
  );
}

export type ProviderOutcome = 'ACCEPTED' | 'REJECTED';

export function makeProcessor(
  dataSource: DataSource,
  credits: SmsCreditService,
  outcome: ProviderOutcome,
  pushAccepted = 0,
): CommunicationsProcessor {
  const provider = {
    send: async () =>
      outcome === 'ACCEPTED'
        ? { success: true, providerMessageId: 'test', outcome: 'ACCEPTED', segments: 1 }
        : {
            success: false,
            providerMessageId: null,
            error: 'rejected',
            outcome: 'REJECTED',
            retryable: false,
          },
  };
  return new CommunicationsProcessor(
    dataSource.getRepository(CommunicationLog),
    dataSource.getRepository(Guardian),
    { resolve: () => provider } as any,
    { isActive: async () => true } as any,
    credits,
    { sendToUser: async () => ({ accepted: pushAccepted, transient: 0, pruned: 0 }) } as any,
  );
}

export async function runJob(processor: CommunicationsProcessor, data: unknown): Promise<void> {
  await processor.process({
    name: 'send',
    data,
    opts: { attempts: 1 },
    attemptsMade: 0,
  } as unknown as Job);
}

export function ledgerFor(dataSource: DataSource, tenantId: string): Promise<SmsCreditLedger[]> {
  return dataSource.getRepository(SmsCreditLedger).find({
    where: { tenant_id: tenantId },
    order: { created_at: 'ASC' },
  });
}

export async function balanceFor(
  dataSource: DataSource,
  tenantId: string,
): Promise<{ available: number; reserved: number }> {
  const row = await dataSource
    .getRepository(SmsCreditBalance)
    .findOne({ where: { tenant_id: tenantId } });
  return { available: row?.available ?? 0, reserved: row?.reserved ?? 0 };
}
