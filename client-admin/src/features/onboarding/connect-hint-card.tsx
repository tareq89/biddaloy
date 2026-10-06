/**
 * [13.5.1] One-time hint that Google / Facebook sign-in exists. Shown when at
 * least one provider is configured and the user has no linked identity; the X
 * stores a per-user flag in localStorage (a failing storage only means the
 * hint shows again).
 */
import { Button } from '@biddaloy/ui/components';
import {
  identitiesQueryOptions,
  socialProvidersQueryOptions,
  useCurrentUserId,
  useStartSocialLink,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useQuery } from '@tanstack/react-query';
import { XIcon } from 'lucide-react';
import * as React from 'react';

const key = (userId: string) => `biddaloy:connect-hint-dismissed:${userId}`;

function readDismissed(userId: string | null): boolean {
  if (!userId) return false;
  try {
    return localStorage.getItem(key(userId)) === '1';
  } catch {
    return false;
  }
}

export function ConnectHintCard() {
  const { t } = useTranslation('setupChecklist');
  const userId = useCurrentUserId();
  const [dismissed, setDismissed] = React.useState(() => readDismissed(userId));
  const link = useStartSocialLink();
  const providers = useQuery({ ...socialProvidersQueryOptions(), enabled: !dismissed });
  const identities = useQuery({ ...identitiesQueryOptions(), enabled: !dismissed });
  if (
    dismissed ||
    !userId ||
    !providers.data?.length ||
    !identities.data ||
    identities.data.length > 0
  ) {
    return null;
  }
  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(key(userId), '1');
    } catch {
      /* the hint just shows again next time */
    }
  };
  return (
    <section
      aria-labelledby="connect-hint-heading"
      className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface p-4 md:flex-row md:items-center"
    >
      <div className="flex-1">
        <h2 id="connect-hint-heading" className="text-h3">
          {t('hint.title')}
        </h2>
        <p className="text-text-secondary">{t('hint.body')}</p>
      </div>
      {/* ponytail: linking needs the bearer token, so the SPA fetches the provider URL
          (useStartSocialLink) instead of linking to socialStartUrl(..., 'link'). */}
      <div className="flex flex-col gap-2 md:flex-row">
        {providers.data.map((p) => (
          <Button
            key={p}
            variant="outline"
            className="h-11 md:h-9"
            disabled={link.isPending}
            onClick={() => link.mutate(p, { onSuccess: (url) => window.location.assign(url) })}
          >
            {t(`hint.${p}`)}
          </Button>
        ))}
      </div>
      {link.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t('hint.failed')}
        </p>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="size-11 md:size-8"
        aria-label={t('hint.dismiss')}
        onClick={dismiss}
      >
        <XIcon className="size-4" aria-hidden="true" />
      </Button>
    </section>
  );
}
