import type { EventEmitter } from 'events';
import type { AlertRuleKey } from '@biddaloy/shared';

export const ATTENTION_RECHECK = 'attention.recheck';

export interface AttentionRecheckPayload {
  tenantId: string;
  ruleKey: AlertRuleKey;
  actorUserId?: string;
}

/**
 * For owner modules (W3/W4): call
 * `emitRecheck(attentionEvents, { tenantId, ruleKey, actorUserId })` AFTER your
 * own transaction commits. Plain import, no Nest DI (same as `feesEvents` in
 * fees/fee-generation.service.ts). Bursts for the same tenant+rule debounce
 * into one run.
 */
export function emitRecheck(events: EventEmitter, payload: AttentionRecheckPayload): void {
  events.emit(ATTENTION_RECHECK, payload);
}
