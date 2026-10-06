import { audienceForRoles, type UserRole } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  SetPasswordForm,
  StatusBadge,
  toast,
  weakPasswordRules,
  type SignInFormError,
} from '@biddaloy/ui/components';
import {
  identitiesQueryOptions,
  setFirstPassword,
  socialProvidersQueryOptions,
  useDisconnectIdentity,
  useStartSocialLink,
  type SocialProvider,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import * as React from 'react';

export interface SignInMethodsCardProps {
  /** Every role the account holds; decides which password rules apply. */
  roles: UserRole[];
}

/**
 * "Sign-in methods": password, the always-on code, and one row per configured
 * Google / Facebook provider. Used on `/security` and `/portal/account`.
 *
 * The server does not say whether the account already has a password, so the
 * Password row makes no claim either way: one neutral "Set or change" action.
 */
export function SignInMethodsCard({ roles }: SignInMethodsCardProps) {
  const { t } = useTranslation('signInMethods');
  const router = useRouter();

  const providers = useQuery(socialProvidersQueryOptions());
  const identities = useQuery(identitiesQueryOptions());
  const startLink = useStartSocialLink();
  const disconnect = useDisconnectIdentity();

  const [passwordOpen, setPasswordOpen] = React.useState(false);
  const [lastMethod, setLastMethod] = React.useState(false);

  // The server's callback comes back as `?linked=google` / `?social=…`.
  // Toast once, then drop the param so a reload does not repeat it.
  React.useEffect(() => {
    const params = new URLSearchParams(router.state.location.searchStr);
    const linked = params.get('linked');
    const social = params.get('social');
    if (!linked && !social) return;
    // Only known provider names are echoed back, never raw URL text.
    const name = (v: string | null) => (v === 'google' || v === 'facebook' ? t(v) : '');
    if (linked) toast.success(t('linked', { provider: name(linked) }));
    else if (social === 'conflict') toast.error(t('conflict'));
    else if (social === 'cancelled') toast.error(t('cancelled'));
    else if (social === 'failed') toast.error(t('failed'));
    router.history.replace(router.state.location.pathname);
  }, [router, t]);

  const setPassword = useMutation({
    mutationFn: setFirstPassword,
    onSuccess: () => {
      setPasswordOpen(false);
      toast.success(t('password.saved'));
    },
    onError: (error) => {
      // 409: a password already exists (another tab or device set it).
      if (error instanceof ApiError && error.statusCode === 409) {
        setPasswordOpen(false);
        toast.success(t('password.alreadySet'));
      }
    },
  });

  const passwordError: SignInFormError | null =
    setPassword.error && !weakPasswordRules(setPassword.error)
      ? { message: t('error'), tone: 'alert' }
      : null;

  const connected = new Map((identities.data ?? []).map((i) => [i.provider, i]));
  const providerList = providers.data ?? [];
  const showProviders = providerList.length > 0 && identities.isSuccess;

  // A button, not a plain link: the start URL needs the bearer token, so fetch it, then navigate.
  function handleConnect(provider: SocialProvider): void {
    startLink.mutate(provider, {
      onSuccess: (url) => window.location.assign(url),
      onError: () => toast.error(t('error')),
    });
  }

  function handleDisconnect(provider: SocialProvider): void {
    setLastMethod(false);
    disconnect.mutate(provider, {
      onError: (error) => {
        if (error instanceof ApiError && error.details?.code === 'LAST_SIGN_IN_METHOD') {
          setLastMethod(true);
        } else {
          toast.error(t('error'));
        }
      },
    });
  }

  return (
    <Card asChild padded>
      <section aria-labelledby="sign-in-methods-title">
        <h2 id="sign-in-methods-title" className="text-h2">
          {t('title')}
        </h2>
        <ul className="mt-3 divide-y divide-border-subtle border-t border-border-subtle">
          <Row
            label={t('password.title')}
            // ponytail: no has_password flag from the server, so no "set / not set" claim; see #1694.
            action={
              <Button
                type="button"
                variant="outline"
                className="min-h-11 sm:min-h-0"
                onClick={() => setPasswordOpen(true)}
              >
                {t('password.change')}
              </Button>
            }
          />
          <Row label={t('code')} status={<StatusBadge tone="success" label={t('alwaysOn')} />} />
          {showProviders &&
            providerList.map((provider) => {
              const identity = connected.get(provider);
              const label = t(provider);
              return (
                <Row
                  key={provider}
                  label={label}
                  detail={identity ? t('connected', { email: identity.email ?? '' }) : null}
                  action={
                    identity ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="min-h-11 sm:min-h-0"
                        aria-label={`${t('disconnect')} ${label}`}
                        loading={disconnect.isPending && disconnect.variables === provider}
                        onClick={() => handleDisconnect(provider)}
                      >
                        {t('disconnect')}
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        className="min-h-11 sm:min-h-0"
                        aria-label={`${t('connect')} ${label}`}
                        loading={startLink.isPending && startLink.variables === provider}
                        onClick={() => handleConnect(provider)}
                      >
                        {t('connect')}
                      </Button>
                    )
                  }
                />
              );
            })}
        </ul>
        {lastMethod && (
          <p role="alert" className="mt-3 text-destructive">
            {t('cannotDisconnect')}
          </p>
        )}
        {identities.isError && (
          <p role="alert" className="mt-3 text-destructive">
            {t('error')}
          </p>
        )}
        <Dialog
          open={passwordOpen}
          onOpenChange={(open) => {
            setPasswordOpen(open);
            if (!open) setPassword.reset();
          }}
        >
          <DialogContent size="md">
            <DialogHeader>
              <DialogTitle className="sr-only">{t('password.change')}</DialogTitle>
            </DialogHeader>
            <SetPasswordForm
              heading={t('password.change')}
              audience={audienceForRoles(roles)}
              onSubmit={(password) => setPassword.mutate(password)}
              loading={setPassword.isPending}
              error={passwordError}
              failedRules={weakPasswordRules(setPassword.error)}
              submitLabel={t('password.setNow')}
            />
          </DialogContent>
        </Dialog>
      </section>
    </Card>
  );
}

function Row({
  label,
  detail,
  status,
  action,
}: {
  label: string;
  detail?: string | null;
  status?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
      <div className="min-w-0 flex-1">
        <p className="font-medium">{label}</p>
        {detail && <p className="text-caption break-all text-text-secondary">{detail}</p>}
      </div>
      {status}
      {action}
    </li>
  );
}
