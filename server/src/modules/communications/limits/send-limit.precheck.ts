import { ConflictException } from '@nestjs/common';
import { type CommunicationMedium, DAILY_LIMIT_REACHED } from '@biddaloy/shared';
import type { CommunicationProviderRegistryService } from '../providers/communication-provider.registry';
import { isMessageSink } from '../providers/sink/message-sink';
import type { SendLimitService } from './send-limit.service';

export interface SendLimitPrecheckDeps {
  registry: Pick<CommunicationProviderRegistryService, 'resolveFor'>;
  limits: Pick<SendLimitService, 'remaining'>;
}

/**
 * [60.0 D2, D12, D21] A person pressing Send for a whole batch: refuse the batch as one if it does
 * not fit in what is left of today's limit. `recipientCount` is messages, not SMS segments (D21).
 * Call it BEFORE any credit reservation so nothing has to be released.
 *
 * Human bulk entry points only. Automated sends (absence/arrival notices, fee notifications,
 * homework notices) get no pre-check (D27): past the limit they fail one by one at the registry
 * and show in the message log.
 *
 * ponytail: check-then-send; the registry is the hard gate (two racing batches may both pass).
 */
export async function assertRoomForBatch(
  deps: SendLimitPrecheckDeps | undefined,
  tenantId: string,
  medium: CommunicationMedium,
  recipientCount: number,
): Promise<void> {
  // MESSAGE_SINK=mailpit: the registry bypasses config and limits, so the precheck does too.
  if (!deps || recipientCount <= 0 || isMessageSink()) return;
  let source: string;
  try {
    source = (await deps.registry.resolveFor(medium, tenantId)).source;
  } catch {
    return; // no provider configured: the existing path reports it
  }
  if (source !== 'platform') return;
  const { remaining, limit } = await deps.limits.remaining(tenantId, medium);
  if (recipientCount > remaining) {
    throw new ConflictException({
      message: 'Daily limit reached.',
      details: { code: DAILY_LIMIT_REACHED, requested: recipientCount, remaining, limit },
    });
  }
}
