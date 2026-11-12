import type { ImpersonationSessionDto } from '@biddaloy/shared';
import { Button, ConfirmDialog } from '@biddaloy/ui/components';
import { impersonationKeys, useEndLoginAs, useLoginAsSessions } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { useQueryClient } from '@tanstack/react-query';
import * as React from 'react';

/** Mockup "Live sessions strip": who is signed in to a school right now. Hidden when nobody is. */
const POLL_MS = 30_000;

export interface LiveSessionsStripViewProps {
  sessions: readonly ImpersonationSessionDto[];
  now: number;
  onEnd: (id: string) => void;
  busyId?: string | undefined;
  error?: boolean;
}

export function LiveSessionsStripView({
  sessions,
  now,
  onEnd,
  busyId,
  error,
}: LiveSessionsStripViewProps) {
  const { t } = useTranslation('schoolsList');
  const { t: tRole } = useTranslation('loginAs');
  const config = useRegionConfig();
  const [pending, setPending] = React.useState<ImpersonationSessionDto | null>(null);

  if (sessions.length === 0) return null;
  const role = (r: string) => tRole(`roles.${r}`, { defaultValue: r });

  return (
    <section
      aria-label={t('live.title', { count: sessions.length })}
      className="rounded-lg border border-border-functional bg-surface p-3"
    >
      <h2 className="text-label font-medium">{t('live.title', { count: sessions.length })}</h2>
      <ul className="mt-2 flex gap-2 overflow-x-auto md:flex-wrap md:overflow-visible">
        {sessions.map((s) => {
          const minutes = Math.max(
            0,
            Math.ceil((Date.parse(s.expiresAt ?? '') - now) / 60_000) || 0,
          );
          return (
            <li
              key={s.id}
              className="flex shrink-0 items-center gap-2 rounded-md bg-muted px-3 py-1"
            >
              <span>
                {t('live.item', {
                  school: s.schoolName,
                  person: s.userName,
                  role: role(s.role),
                  minutes: formatNumber(minutes, config),
                })}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="min-h-11 md:min-h-8"
                disabled={busyId === s.id}
                aria-label={t('live.endFor', { school: s.schoolName, person: s.userName })}
                onClick={() => setPending(s)}
              >
                {t('live.end')}
              </Button>
            </li>
          );
        })}
      </ul>
      {error && (
        <p role="alert" className="mt-2 text-destructive">
          {t('live.error')}
        </p>
      )}
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title={t('live.confirmTitle')}
        description={
          pending
            ? t('live.confirmDescription', { person: pending.userName, school: pending.schoolName })
            : ''
        }
        confirmLabel={t('live.end')}
        onConfirm={() => {
          if (pending) onEnd(pending.id);
          setPending(null);
        }}
      />
    </section>
  );
}

export function LiveSessionsStrip() {
  const query = useLoginAsSessions({ scope: 'live' });
  const end = useEndLoginAs();
  const queryClient = useQueryClient();
  const [now, setNow] = React.useState(() => Date.now());

  // The hook has no refetch interval, so the strip asks again every 30 s.
  React.useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
      void queryClient.invalidateQueries({ queryKey: impersonationKeys.all });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [queryClient]);

  return (
    <LiveSessionsStripView
      sessions={query.data ?? []}
      now={now}
      onEnd={(id) => end.mutate({ id })}
      busyId={end.isPending ? end.variables?.id : undefined}
      error={end.isError}
    />
  );
}
