import { setAccessToken } from '@biddaloy/ui/api';
import {
  Button,
  Card,
  ConfirmDialog,
  ErrorState,
  RecoveryCodesCard,
  SessionList,
  toast,
} from '@biddaloy/ui/components';
import {
  ApprovalCancelledError,
  logoutAll,
  useCockpitMfaStatus,
  useCockpitSessions,
  useRegenerateRecoveryCodes,
  useRevokeCockpitSession,
} from '@biddaloy/ui/hooks';
import { useLocale, useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import * as React from 'react';

/** Plain `<details>` help, the same pattern as the sign-in card: works by keyboard, needs no index. */
function CardHelp({ id }: { id: 'twoStep' | 'codes' | 'devices' }) {
  const { t } = useTranslation('ownerSecurity');
  return (
    <details className="text-sm text-text-secondary">
      <summary className="min-h-11 cursor-pointer py-2">{t(`help.${id}.title`)}</summary>
      <p>{t(`help.${id}.body`)}</p>
    </details>
  );
}

/** Two-step on/off and a link to the wizard. Mockup e. */
export function TwoStepCard({
  onRetry,
  enrolled,
  failed,
}: {
  enrolled: boolean;
  failed: boolean;
  onRetry: () => void;
}) {
  const { t } = useTranslation('ownerSecurity');
  return (
    <Card padded aria-labelledby="two-step-title" className="flex flex-col gap-3">
      <h2 id="two-step-title" className="text-h2">
        {t('twoStep.title')}
      </h2>
      {failed ? (
        <ErrorState
          message={t('twoStep.loadError')}
          retryLabel={t('twoStep.retry')}
          onRetry={onRetry}
        />
      ) : (
        <>
          <p>
            <strong>{enrolled ? t('twoStep.on') : t('twoStep.off')}</strong>
            {' · '}
            <span className="text-text-secondary">
              {enrolled ? t('twoStep.onBody') : t('twoStep.offBody')}
            </span>
          </p>
          <Button
            asChild
            variant={enrolled ? 'outline' : 'default'}
            className="min-h-11 self-start"
          >
            <Link to={'/owner-security/two-step' as '/'}>
              {enrolled ? t('twoStep.replace') : t('twoStep.setUp')}
            </Link>
          </Button>
        </>
      )}
      <CardHelp id="twoStep" />
    </Card>
  );
}

/**
 * How many recovery codes are left, and "Make new codes". Confirming asks for a code through the
 * approval modal (`platform.recovery_codes`); the new codes show once and are never stored.
 */
export function RecoveryCodesSection({ remaining }: { remaining: number | undefined }) {
  const { t } = useTranslation('ownerSecurity');
  const regenerate = useRegenerateRecoveryCodes();
  const [confirming, setConfirming] = React.useState(false);
  const [codes, setCodes] = React.useState<string[] | null>(null);
  const [saved, setSaved] = React.useState(false);

  return (
    <Card padded aria-labelledby="codes-title" className="flex flex-col gap-3">
      <h2 id="codes-title" className="text-h2">
        {t('codes.title')}
      </h2>
      {codes ? (
        <>
          <RecoveryCodesCard
            codes={codes}
            onAcknowledged={setSaved}
            headingLevel="h3"
            labels={{
              title: t('recoveryCodes.title'),
              description: t('recoveryCodes.description'),
              copy: t('recoveryCodes.copy'),
              copied: t('recoveryCodes.copied'),
              download: t('recoveryCodes.download'),
              acknowledge: t('recoveryCodes.acknowledge'),
            }}
          />
          <Button
            className="min-h-11 self-start"
            disabled={!saved}
            onClick={() => {
              setCodes(null);
              setSaved(false);
            }}
          >
            {t('codes.done')}
          </Button>
        </>
      ) : (
        <>
          <p>
            {remaining === undefined
              ? ''
              : remaining === 0
                ? t('codes.none')
                : t('codes.remaining', { count: remaining })}
          </p>
          <p className="text-text-secondary">{t('codes.makeBody')}</p>
          {regenerate.isError && !(regenerate.error instanceof ApprovalCancelledError) && (
            <p role="alert" className="text-destructive">
              {t('codes.error')}
            </p>
          )}
          <Button
            variant="outline"
            className="min-h-11 self-start"
            disabled={regenerate.isPending}
            onClick={() => {
              regenerate.reset();
              setConfirming(true);
            }}
          >
            {t('codes.make')}
          </Button>
        </>
      )}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        tone="danger"
        title={t('codes.confirmTitle')}
        description={t('codes.confirmBody')}
        confirmLabel={t('codes.make')}
        cancelLabel={t('codes.confirmCancel')}
        busy={regenerate.isPending}
        onConfirm={() => {
          setConfirming(false);
          regenerate.mutate(undefined, {
            onSuccess: (result) => {
              setSaved(false);
              setCodes(result.recoveryCodes);
            },
          });
        }}
      />
      <CardHelp id="codes" />
    </Card>
  );
}

/** Signed-in devices and "Sign out everywhere" (`logoutAll` is pointed at the cockpit endpoint in `main.tsx`). */
export function DevicesSection({ onSignedOutEverywhere }: { onSignedOutEverywhere: () => void }) {
  const { t } = useTranslation('ownerSecurity');
  const config = useRegionConfig();
  const { locale } = useLocale();
  const queryClient = useQueryClient();
  const sessions = useCockpitSessions();
  const revoke = useRevokeCockpitSession();
  const list = React.useMemo(
    () =>
      [...(sessions.data ?? [])].sort(
        (a, b) =>
          Number(b.current) - Number(a.current) || b.last_used_at.localeCompare(a.last_used_at),
      ),
    [sessions.data],
  );

  async function signOutEverywhere(): Promise<void> {
    try {
      await logoutAll(queryClient);
    } catch {
      // `logoutAll` clears local auth state in its own `finally`; leave either way.
    } finally {
      onSignedOutEverywhere();
    }
  }

  return (
    <section aria-labelledby="devices-title" className="space-y-3">
      <div>
        <h2 id="devices-title" className="text-h2">
          {t('devices.title')}
        </h2>
        <p className="mt-1 text-text-secondary">{t('devices.description')}</p>
      </div>
      {sessions.isError ? (
        <ErrorState
          message={t('devices.error')}
          retryLabel={t('devices.retry')}
          onRetry={() => void sessions.refetch()}
        />
      ) : (
        <>
          {revoke.isError && (
            <p role="alert" className="text-destructive">
              {t('devices.revokeError')}
            </p>
          )}
          <SessionList
            sessions={list}
            loading={sessions.isPending}
            onRevoke={(id) => {
              const current = list.find((s) => s.id === id)?.current ?? false;
              revoke.mutate(id, {
                onSuccess: () => {
                  if (current) {
                    setAccessToken(null);
                    onSignedOutEverywhere();
                  } else toast.success(t('devices.revokedToast'));
                },
              });
            }}
            onRevokeAll={() => void signOutEverywhere()}
            revokingId={revoke.isPending ? (revoke.variables ?? null) : null}
            onRetry={() => void sessions.refetch()}
            config={config}
            locale={locale}
          />
        </>
      )}
      <CardHelp id="devices" />
    </section>
  );
}

/** Reads the status once for the page's two cards. */
export function useOwnerMfaStatus() {
  const status = useCockpitMfaStatus();
  return {
    enrolled: status.data?.enrolled ?? false,
    remaining: status.data?.recoveryRemaining,
    failed: status.isError,
    retry: () => void status.refetch(),
  };
}
