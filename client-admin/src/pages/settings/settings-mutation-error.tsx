import { ApiError } from '@biddaloy/ui/api';
import { useTranslation } from '@biddaloy/ui/i18n';
import { CircleAlertIcon } from 'lucide-react';

/**
 * A failed settings request, in words: never the server's own `message`
 * (D9: it is English, technical and sometimes names internals). Only the
 * HTTP status picks the sentence.
 */
export function SettingsMutationError({ error }: { error: unknown }) {
  const { t } = useTranslation('settings');
  const forbidden = error instanceof ApiError && error.statusCode === 403;
  return (
    <p role="alert" className="flex items-center gap-1.5 text-destructive">
      <CircleAlertIcon aria-hidden="true" className="size-4 shrink-0" />
      {t(forbidden ? 'mutationError.forbidden' : 'mutationError.generic')}
    </p>
  );
}
