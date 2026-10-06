import { useTranslation } from '@biddaloy/ui/i18n';

/**
 * `useMutation`'s `error` is typed `TError | null` where `TError` defaults
 * to `unknown` for every hook in `school-settings.ts` — passing
 * `shouldRetryQuery` (typed `(failureCount, error: unknown) => boolean`)
 * as the `retry` option widens `TError` to `unknown` for that call, since
 * TS infers it from the narrowest type every option's callback accepts.
 * A real `Error` (what `apiClient`'s interceptor always throws — see
 * `api/errors.ts`) narrows cleanly via `instanceof`; anything else falls
 * back to `String(error)` rather than a type-error at the call site.
 *
 * [13.5.1] A 409 `SEAT_LIMIT_REACHED` (trial school is full) renders a
 * translated message with the numbers from `details` instead of the raw text.
 */
export function MutationErrorMessage({ error }: { error: unknown }) {
  const { t } = useTranslation('trial');
  const details = (error as { details?: Record<string, unknown> } | null)?.details;
  if (details?.code === 'SEAT_LIMIT_REACHED') {
    const { used, limit, requested } = details;
    return (
      <p role="alert" className="text-sm text-destructive">
        <strong>{t('seatLimit.title')}</strong>{' '}
        {requested === undefined
          ? t('seatLimit.bodyNoRequest', { used: Number(used), limit: Number(limit) })
          : t('seatLimit.body', {
              used: Number(used),
              limit: Number(limit),
              requested: Number(requested),
            })}{' '}
        {t('seatLimit.hint')}
      </p>
    );
  }
  return (
    <p role="alert" className="text-sm text-destructive">
      {error instanceof Error ? error.message : String(error)}
    </p>
  );
}
