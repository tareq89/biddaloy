import { SetMetadata } from '@nestjs/common';
import { AuditAction } from '@beton-boi/shared';

export const AUDITED_METADATA_KEY = 'audited';

export interface AuditedMetadata {
  action: AuditAction;
  entityType: string;
}

/**
 * Marks a controller route handler as a mechanical create whose audit
 * record can be derived entirely from the response body — deliberately
 * not a blanket interceptor on every mutation (see AuditInterceptor):
 * an update needs old-vs-new diffing the response alone can't provide, and
 * a batch operation needs one row per action rather than per response, so
 * those cases call AuditService.record() directly instead.
 */
export const Audited = (action: AuditAction, entityType: string) =>
  SetMetadata(AUDITED_METADATA_KEY, { action, entityType });
