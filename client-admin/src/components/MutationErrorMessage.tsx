import { Permission } from '@biddaloy/shared';
import { isTenantRestoringError } from '@biddaloy/ui/api';
import { useHasPermission } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

import { SeatLimitReachedAction } from '../features/billing/SeatLimitReachedDialog';

/**
 * A failed mutation, in words: never the server's own `message` (it is
 * English and sometimes technical). Only the HTTP status picks the sentence,
 * read duck-typed so a plain `Error` or a network failure gets the generic one.
 *
 * [13.5.1] A 409 `SEAT_LIMIT_REACHED` (trial school is full) renders a
 * translated message with the numbers from `details`.
 */
function errorKey(error: unknown): string {
  if (isTenantRestoringError(error)) return 'errors.schoolRestoring';
  switch ((error as { statusCode?: unknown } | null)?.statusCode) {
    case 403:
      return 'errors.permissionDenied';
    case 413:
      return 'errors.uploadTooLarge';
    case 409:
      return 'errors.conflict';
    case 400:
      return 'errors.invalid';
    default:
      return 'errors.generic';
  }
}

export function MutationErrorMessage({ error }: { error: unknown }) {
  const { t } = useTranslation('trial');
  const { t: tc } = useTranslation('common');
  const canBuy = useHasPermission(Permission.SETTINGS_MANAGE);
  const details = (error as { details?: Record<string, unknown> } | null)?.details;
  if (details?.code === 'SEAT_LIMIT_REACHED') {
    const { used, limit, requested } = details;
    return (
      <div role="alert" className="text-sm text-destructive">
        <p>
          <strong>{t('seatLimit.title')}</strong>{' '}
          {requested === undefined
            ? t('seatLimit.bodyNoRequest', { used: Number(used), limit: Number(limit) })
            : t('seatLimit.body', {
                used: Number(used),
                limit: Number(limit),
                requested: Number(requested),
              })}{' '}
          {!canBuy && t('seatLimit.hint')}
        </p>
        {canBuy && (
          <SeatLimitReachedAction
            shortfall={Number(used) + Number(requested ?? 1) - Number(limit)}
          />
        )}
      </div>
    );
  }
  return (
    <p role="alert" className="text-sm text-destructive">
      {tc(errorKey(error))}
    </p>
  );
}
