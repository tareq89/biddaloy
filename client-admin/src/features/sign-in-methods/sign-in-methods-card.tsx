import { audienceForRoles, type UserRole } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  Card,
  ChangePasswordForm,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  SetPasswordForm,
  StatusBadge,
  toast,
  weakPasswordRules,
  passwordTooLong,
  type ChangePasswordFormServerError,
  type SignInFormError,
} from '@biddaloy/ui/components';
import {
  changePassword,
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
  // 'change' once the server says a password exists (409): ask for the current one.
  const [passwordMode, setPasswordMode] = React.useState<'set' | 'change'>('set');
  const [lastMethod, setLastMethod] = React.useState(false);
  const [connectProvider, setConnectProvider] = React.useState<SocialProvider | null>(null);
  const [connectPassword, setConnectPassword] = React.useState('');
  const [connectError, setConnectError] = React.useState<'wrong' | 'noPassword' | null>(null);

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
      // 409: a password already exists, so switch the dialog to the change flow.
      if (error instanceof ApiError && error.statusCode === 409) setPasswordMode('change');
    },
  });

  const changePw = useMutation({
    mutationFn: changePassword,
    retry: false,
    onSuccess: () => {
      setPasswordOpen(false);
      toast.success(t('password.changed'));
    },
  });

  // Memoised: the form re-applies `serverError` whenever its identity changes,
  // so an unrelated parent render must not hand it a fresh object for the same 403.
  const changeError = React.useMemo<ChangePasswordFormServerError | null>(
    () =>
      !changePw.error
        ? null
        : changePw.error instanceof ApiError && changePw.error.statusCode === 403
          ? { fieldErrors: { current_password: t('password.wrongCurrent') } }
          : weakPasswordRules(changePw.error) || passwordTooLong(changePw.error)
            ? null
            : { message: t('error') },
    [changePw.error, t],
  );

  const passwordError: SignInFormError | null =
    setPassword.error &&
    !weakPasswordRules(setPassword.error) &&
    !passwordTooLong(setPassword.error)
      ? { message: t('error'), tone: 'alert' }
      : null;

  const connected = new Map((identities.data ?? []).map((i) => [i.provider, i]));
  const providerList = providers.data ?? [];
  const showProviders = providerList.length > 0 && identities.isSuccess;

  // Connecting needs the current password. The start URL also needs the bearer token,
  // so fetch it (after the password check), then navigate.
  function handleConnectSubmit(event: React.FormEvent): void {
    event.preventDefault();
    if (!connectProvider) return;
    setConnectError(null);
    startLink.mutate(
      { provider: connectProvider, currentPassword: connectPassword },
      {
        onSuccess: (url) => window.location.assign(url),
        onError: (error) => {
          if (error instanceof ApiError && error.details?.code === 'NO_PASSWORD') {
            setConnectError('noPassword');
          } else if (error instanceof ApiError && error.statusCode === 403) {
            setConnectError('wrong');
          } else {
            closeConnect(); // also drops the typed password
            toast.error(t('error'));
          }
        },
      },
    );
  }

  function closeConnect(): void {
    setConnectProvider(null);
    setConnectPassword('');
    setConnectError(null);
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
                onClick={() => {
                  setPassword.reset();
                  changePw.reset();
                  setPasswordMode('set');
                  setPasswordOpen(true);
                }}
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
                        aria-label={t('disconnectProvider', { provider: label })}
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
                        aria-label={t('connectProvider', { provider: label })}
                        onClick={() => setConnectProvider(provider)}
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
          open={connectProvider !== null}
          onOpenChange={(open) => {
            if (!open) closeConnect();
          }}
        >
          <DialogContent size="md">
            <DialogHeader>
              <DialogTitle>{t('connectPassword.title')}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleConnectSubmit} className="flex flex-col gap-3">
              <Label htmlFor="connect-current-password">{t('connectPassword.label')}</Label>
              <Input
                id="connect-current-password"
                type="password"
                autoComplete="current-password"
                required
                // eslint-disable-next-line jsx-a11y/no-autofocus -- the dialog just opened for this one field
                autoFocus
                aria-invalid={connectError ? true : undefined}
                aria-describedby={connectError ? 'connect-password-error' : undefined}
                value={connectPassword}
                onChange={(e) => {
                  setConnectPassword(e.target.value);
                  // A new attempt makes "wrong password" stale; "no password" still holds.
                  if (connectError === 'wrong') setConnectError(null);
                }}
              />
              {connectError && (
                <p id="connect-password-error" role="alert" className="text-destructive">
                  {t(`connectPassword.${connectError}`)}
                </p>
              )}
              <Button type="submit" loading={startLink.isPending}>
                {t('connectPassword.submit')}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
        <Dialog
          open={passwordOpen}
          onOpenChange={(open) => {
            setPasswordOpen(open);
            if (!open) {
              setPassword.reset();
              changePw.reset();
            }
          }}
        >
          <DialogContent size="md">
            <DialogHeader>
              <DialogTitle className="sr-only">{t('password.change')}</DialogTitle>
            </DialogHeader>
            {passwordMode === 'change' ? (
              <>
                <p className="text-sm text-muted-foreground">{t('password.changeHint')}</p>
                <ChangePasswordForm
                  audience={audienceForRoles(roles)}
                  onSubmit={(values) => changePw.mutate(values)}
                  submitting={changePw.isPending}
                  serverError={changeError}
                  failedRules={weakPasswordRules(changePw.error)}
                  tooLong={passwordTooLong(changePw.error)}
                />
              </>
            ) : (
              <SetPasswordForm
                heading={t('password.change')}
                audience={audienceForRoles(roles)}
                onSubmit={(password) => setPassword.mutate(password)}
                loading={setPassword.isPending}
                error={passwordError}
                failedRules={weakPasswordRules(setPassword.error)}
                tooLong={passwordTooLong(setPassword.error)}
                submitLabel={t('password.setNow')}
              />
            )}
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
