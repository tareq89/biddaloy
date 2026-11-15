/**
 * [3329.2.03] One place for "the page's request failed": a 403 is the
 * permission screen, anything else is the error screen with Try again.
 * Copy comes from the `states` namespace (no status code is ever shown).
 */
import { ApiError } from '@biddaloy/ui/api';
import { AccessDeniedState, ErrorState } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useNavigate } from '@tanstack/react-router';

export function QueryFailure({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useTranslation('states');
  const navigate = useNavigate();
  if (error instanceof ApiError && error.statusCode === 403) {
    return (
      <AccessDeniedState
        title={t('denied.title')}
        explanation={t('denied.body')}
        onAction={() => void navigate({ to: '/' })}
      />
    );
  }
  return (
    <ErrorState
      title={t('error.title')}
      message={t('error.body')}
      retryLabel={t('error.retry')}
      onRetry={onRetry}
    />
  );
}
