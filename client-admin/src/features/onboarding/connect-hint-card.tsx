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
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useQuery } from '@tanstack/react-query';
import { Link, useRouterState } from '@tanstack/react-router';
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
  const inPortal = useRouterState({ select: (r) => r.location.pathname.startsWith('/portal') });
  const [clicked, setDismissed] = React.useState(false);
  // Re-read per userId: it may arrive after the first render.
  const dismissed = clicked || readDismissed(userId);
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
      {/* [75.3] Connecting needs the current password, asked on the sign-in methods card. */}
      <Button asChild variant="outline" className="min-h-11 w-full md:min-h-0 md:w-auto">
        <Link to={inPortal ? '/portal/account' : '/security'}>{t('hint.setup')}</Link>
      </Button>
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
