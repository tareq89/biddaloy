import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  Card,
  ChangePasswordForm,
  ContactChangeDialog,
  ErrorState,
  GuardianContactForm,
  ProfileForm,
  PushNotificationSettings,
  SessionList,
  Skeleton,
  StatusBadge,
  toast,
  type ChangePasswordFormServerError,
  type ContactChangeField,
  type GuardianContactFormServerError,
  type GuardianContactFormValues,
  type ProfileFormServerError,
  type ProfileFormSubmitValues,
} from '@biddaloy/ui/components';
import {
  changePassword,
  logout,
  logoutAll,
  myGuardianQueryOptions,
  sessionsQueryOptions,
  useActiveRole,
  useConfirmPhoneChange,
  useCurrentUser,
  useRequestContactChange,
  useRevokeSession,
  useUpdateMyGuardian,
  useUpdateOwnProfile,
} from '@biddaloy/ui/hooks';
import {
  RegionConfigProvider,
  useLocale,
  useRegionConfig,
  useTranslation,
} from '@biddaloy/ui/i18n';
import { usePushSubscription } from '@biddaloy/ui/pwa';
import { PageContainer, PageHeader } from '@biddaloy/ui/shells';
import { formatDate, formatPhone, parseValidationFieldErrors } from '@biddaloy/ui/utils';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import {
  ChevronDownIcon,
  ChevronUpIcon,
  LogOutIcon,
  MailIcon,
  PlusIcon,
  SmartphoneIcon,
} from 'lucide-react';
import * as React from 'react';

import { CalendarFeedCard } from '../../components/calendar-feed-card';
import { loadRouteNamespaces } from '../../route-loaders';

/**
 * [8.14.4] `/portal/account` — the first screen anywhere to consume the
 * three self-service endpoints phase 5 shipped: `PATCH /users/me`,
 * `GET`/`PATCH /guardians/mine`, and `POST /auth/change-password`. Plus
 * **sign-out inside the portal** (today the only way
 * to end a session is on `/select-school`, which a guardian on a shared
 * family phone has no reason to visit).
 *
 * Card-based, following `portal/fees.tsx`'s established per-frame
 * conventions:
 *
 * | Frame    | `<h1>`                              |
 * | -------- | ------------------------------------ |
 * | Loaded   | the page title ("Account")           |
 * | Loading  | none — focus falls back to `<main>`  |
 * | Error    | none — focus falls back to `<main>`  |
 *
 * The guardian-contact card renders **only** for `useActiveRole() ===
 * 'PARENT'` — `GET`/`PATCH /guardians/mine` are PARENT-only
 * (`students.controller.ts`'s own `@Roles`), so a STUDENT never even
 * issues the request rather than being sent to 403 into an error state.
 *
 * Region config comes from a value-less `RegionConfigProvider`, same
 * reasoning `portal/fees.tsx`/`portal/index.tsx` document: the real
 * `useTenantRegionConfig()` reads an ADMIN-only settings endpoint a PARENT
 * or STUDENT would 403 on for a value it falls back from anyway.
 */
export const Route = createFileRoute('/portal/account')({
  // [12.8] added the Devices card, which pulls in the `auth` namespace's
  // `sessions.*` strings — preloaded here so first navigation to this route
  // never suspends into a blank `I18nProvider` fallback, same reasoning
  // `route-loaders.ts`'s own doc comment documents for every other route.
  loader: () => loadRouteNamespaces('auth', 'push', 'calendarFeed'),
  component: PortalAccountRoute,
});

function PortalAccountRoute() {
  return (
    <RegionConfigProvider>
      <PortalAccount />
    </RegionConfigProvider>
  );
}

/** Known server-side field names for each mutation's `ValidationPipe`
 * 400 — passed to `parseValidationFieldErrors` so a message like `"phone
 * must match ..."` maps onto the right input instead of only ever showing
 * as a generic banner. */
const PROFILE_FIELDS = ['full_name'] as const;
const GUARDIAN_FIELDS = ['phone', 'alternate_phone', 'email'] as const;

function PortalAccount() {
  const { t } = useTranslation('portal');
  const { t: tAuth } = useTranslation('auth');
  const { t: tPush } = useTranslation('push');
  const config = useRegionConfig();
  const { locale } = useLocale();
  const role = useActiveRole();
  const isParent = role === 'PARENT';
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const sessionsQuery = useQuery(sessionsQueryOptions());
  const revokeSession = useRevokeSession();

  const push = usePushSubscription();
  const pushRefresh = push.refresh;
  React.useEffect(() => {
    void pushRefresh();
  }, [pushRefresh]);
  const [removingPushId, setRemovingPushId] = React.useState<string | null>(null);

  const currentUserQuery = useCurrentUser();
  // [8.14.4] `enabled: isParent` is the actual enforcement of "STUDENT
  // never issues a `/guardians/mine` request" — `GET`/`PATCH
  // /guardians/mine` are PARENT-only (`students.controller.ts`'s own
  // `@Roles`), and a STUDENT hitting it would 403 for no reason, since
  // this card never renders for them anyway. `useMyGuardian()` (no
  // `enabled` param) can't express this, so this composes
  // `myGuardianQueryOptions()` directly instead — same reasoning
  // `portal/fees.tsx`'s own `invoicesQuery` documents for its `enabled`
  // guard.
  const guardianEnabled = isParent;
  const guardianQuery = useQuery({ ...myGuardianQueryOptions(), enabled: guardianEnabled });

  const updateProfile = useUpdateOwnProfile();
  const updateGuardian = useUpdateMyGuardian();
  const requestContactChange = useRequestContactChange();
  const confirmPhoneChange = useConfirmPhoneChange();

  const [contactDialogField, setContactDialogField] = React.useState<ContactChangeField | null>(
    null,
  );
  const [contactError, setContactError] = React.useState<string | null>(null);

  const [profileError, setProfileError] = React.useState<ProfileFormServerError | null>(null);
  const [guardianError, setGuardianError] = React.useState<GuardianContactFormServerError | null>(
    null,
  );
  const [passwordError, setPasswordError] = React.useState<ChangePasswordFormServerError | null>(
    null,
  );
  const [changingPassword, setChangingPassword] = React.useState(false);
  const [signingOut, setSigningOut] = React.useState(false);
  const [showAllDevices, setShowAllDevices] = React.useState(false);

  const pending = currentUserQuery.isPending || (guardianEnabled && guardianQuery.isPending);
  const errored = currentUserQuery.isError || (guardianEnabled && guardianQuery.isError);

  if (pending) return <AccountSkeleton label={t('account.loading')} showGuardian={isParent} />;

  if (errored) {
    return (
      <ErrorState
        message={t('account.error.message')}
        retryLabel={t('account.error.retry')}
        onRetry={() => {
          void currentUserQuery.refetch();
          if (guardianEnabled) void guardianQuery.refetch();
        }}
      />
    );
  }

  const currentUser = currentUserQuery.data;

  function handleProfileSubmit(values: ProfileFormSubmitValues): void {
    setProfileError(null);
    updateProfile.mutate(
      { full_name: values.full_name },
      {
        onSuccess: () => toast.success(t('account.profile.saved')),
        onError: (error) => {
          if (error instanceof ApiError && error.statusCode === 400) {
            setProfileError({
              fieldErrors: parseValidationFieldErrors(error.messages, PROFILE_FIELDS),
            });
            return;
          }
          setProfileError({ message: t('account.error.saveFailed') });
        },
      },
    );
  }

  // [12.7] `ContactChangeDialog`'s `onRequest` — starts the commit-on-verify
  // flow and returns which confirm step follows. Thrown errors are mapped
  // to the dialog's inline `error` string rather than a toast: the dialog
  // stays open so the caller can fix the value/password and retry.
  async function handleContactRequest(
    value: string,
    currentPassword: string,
  ): Promise<'otp' | 'link'> {
    setContactError(null);
    try {
      const field = contactDialogField as ContactChangeField;
      const result = await requestContactChange.mutateAsync(
        field === 'email'
          ? { email: value, current_password: currentPassword }
          : { phone: value, current_password: currentPassword },
      );
      return result.channel;
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 403) {
        setContactError(t('account.contact.errors.wrongPassword'));
      } else if (error instanceof ApiError && error.statusCode === 409) {
        setContactError(t('account.contact.errors.conflict'));
      } else if (error instanceof ApiError && error.statusCode === 400) {
        setContactError(
          error.message === 'no_password'
            ? t('account.contact.errors.noPassword')
            : t('account.contact.errors.generic'),
        );
      } else {
        setContactError(t('account.contact.errors.generic'));
      }
      throw error;
    }
  }

  async function handleConfirmOtp(otp: string): Promise<void> {
    setContactError(null);
    try {
      await confirmPhoneChange.mutateAsync(otp);
      toast.success(t('account.profile.saved'));
    } catch (error) {
      setContactError(t('account.contact.errors.invalidCode'));
      throw error;
    }
  }

  function handleGuardianSubmit(values: GuardianContactFormValues): void {
    setGuardianError(null);
    updateGuardian.mutate(
      {
        phone: values.phone,
        alternate_phone: values.alternate_phone,
        email: values.email,
        preferred_communication: values.preferred_communication,
        notifications_enabled: values.notifications_enabled,
      },
      {
        onSuccess: () => toast.success(t('account.guardian.saved')),
        onError: (error) => {
          if (error instanceof ApiError && error.statusCode === 400) {
            setGuardianError({
              fieldErrors: parseValidationFieldErrors(error.messages, GUARDIAN_FIELDS),
            });
            return;
          }
          setGuardianError({ message: t('account.error.saveFailed') });
        },
      },
    );
  }

  async function handlePasswordSubmit(values: {
    current_password: string;
    new_password: string;
  }): Promise<void> {
    setPasswordError(null);
    setChangingPassword(true);
    try {
      await changePassword(values);
      toast.success(t('account.password.saved'));
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 403) {
        setPasswordError({
          fieldErrors: { current_password: t('account.password.errors.wrongPassword') },
        });
      } else {
        setPasswordError({ message: t('account.error.saveFailed') });
      }
    } finally {
      setChangingPassword(false);
    }
  }

  function handlePushToggle(next: boolean): void {
    if (next) {
      void push.subscribe();
      return;
    }
    if (push.thisDeviceSubscriptionId) handlePushRemove(push.thisDeviceSubscriptionId);
  }

  function handlePushRemove(id: string): void {
    setRemovingPushId(id);
    void push.unsubscribe(id).finally(() => setRemovingPushId(null));
  }

  async function handleSignOutAllDevices(): Promise<void> {
    try {
      await logoutAll(queryClient);
    } catch {
      // `logoutAll()` already clears local auth state/cache in its own
      // `finally` even when the network call fails (offline, a transient
      // 5xx). Swallowed here rather than left to propagate: this handler
      // always navigates away regardless, and its caller discards the
      // promise, so an escaped rejection would only surface as an
      // unhandled-rejection error with nothing left to react to it.
    } finally {
      void navigate({ to: '/login' });
    }
  }

  async function handleSignOut(): Promise<void> {
    setSigningOut(true);
    try {
      await logout(queryClient);
    } catch {
      // `logout()` already clears local auth state/cache in its own
      // `finally` even if the network call itself failed (offline, a
      // transient 5xx) — same pattern `staff-user-menu.tsx`'s
      // `handleSignOut` documents. Swallowed here, not left to propagate:
      // this button always navigates away regardless, so there is nothing
      // left for a caller of this handler to react to.
    } finally {
      void navigate({ to: '/login' });
    }
  }

  // Current device first, then the most recently used. Only five rows show
  // until expanded — twenty rows made this page 4,400 px tall.
  const sortedSessions = [...(sessionsQuery.data ?? [])].sort(
    (a, b) => Number(b.current) - Number(a.current) || b.last_used_at.localeCompare(a.last_used_at),
  );

  return (
    <PageContainer size="narrow">
      <PageHeader title={t('account.title')} subtitle={t('account.subtitle')} />

      <ProfileForm
        defaultValues={{ full_name: currentUser.full_name }}
        onSubmit={handleProfileSubmit}
        submitting={updateProfile.isPending}
        serverError={profileError}
      />

      <Card asChild padded>
        <section aria-labelledby="account-contact-title">
          <h2 id="account-contact-title" className="text-h2">
            {t('account.contact.title')}
          </h2>
          <p className="mt-1 text-text-secondary">{t('account.contact.explanation')}</p>
          <div className="mt-3 divide-y divide-border-subtle border-t border-border-subtle">
            <ContactRow
              icon={<MailIcon className="size-5" aria-hidden="true" />}
              label={t('account.profile.fields.email')}
              value={currentUser.email}
              verifiedAt={currentUser.email_verified_at}
              onChange={() => setContactDialogField('email')}
            />
            <ContactRow
              icon={<SmartphoneIcon className="size-5" aria-hidden="true" />}
              label={t('account.profile.fields.phone')}
              value={currentUser.phone ? formatPhone(currentUser.phone, config) : null}
              verifiedAt={currentUser.phone_verified_at}
              onChange={() => setContactDialogField('phone')}
            />
          </div>
        </section>
      </Card>

      {contactDialogField && (
        <ContactChangeDialog
          field={contactDialogField}
          open={contactDialogField !== null}
          onOpenChange={(open) => {
            if (!open) {
              setContactDialogField(null);
              setContactError(null);
            }
          }}
          config={config}
          onRequest={handleContactRequest}
          onConfirmOtp={handleConfirmOtp}
          loading={requestContactChange.isPending || confirmPhoneChange.isPending}
          error={contactError}
        />
      )}

      {isParent && guardianQuery.data && (
        <GuardianContactForm
          defaultValues={{
            phone: guardianQuery.data.phone ?? '',
            alternate_phone: guardianQuery.data.alternate_phone ?? '',
            email: guardianQuery.data.email ?? '',
            preferred_communication: guardianQuery.data.preferred_communication,
            notifications_enabled: guardianQuery.data.notifications_enabled,
          }}
          config={config}
          onSubmit={handleGuardianSubmit}
          submitting={updateGuardian.isPending}
          serverError={guardianError}
        />
      )}

      <ChangePasswordForm
        onSubmit={(values) => void handlePasswordSubmit(values)}
        submitting={changingPassword}
        serverError={passwordError}
      />

      <PushNotificationSettings
        permission={push.permission}
        isSubscribedOnThisDevice={push.isSubscribedOnThisDevice}
        thisDeviceSubscriptionId={push.thisDeviceSubscriptionId}
        subscriptions={push.subscriptions}
        loading={push.loading}
        // The hook returns the key with its namespace prefix
        // (`push.errors.listFailed`); `tPush` is already the `push` namespace.
        error={push.error ? tPush(push.error.replace(/^push\./, '')) : null}
        removingId={removingPushId}
        onToggle={handlePushToggle}
        onRemove={handlePushRemove}
        locale={locale}
      />

      <Card asChild padded>
        <section aria-labelledby="account-devices-title">
          <h2 id="account-devices-title" className="text-h2">
            {t('account.devices.title')}
          </h2>
          <p className="mt-1 text-text-secondary">{tAuth('sessions.description')}</p>
          <div className="mt-3">
            <SessionList
              variant="compact"
              sessions={showAllDevices ? sortedSessions : sortedSessions.slice(0, 5)}
              loading={sessionsQuery.isPending}
              error={sessionsQuery.isError ? tAuth('sessions.error') : null}
              onRevoke={(id) => {
                const target = sessionsQuery.data?.find((session) => session.id === id);
                const current = target?.current ?? false;
                revokeSession.mutate(
                  { id, current },
                  {
                    onSuccess: () => !current && toast.success(tAuth('sessions.revokedToast')),
                    onError: () => toast.error(t('account.devices.revokeError')),
                  },
                );
              }}
              onRevokeAll={() => void handleSignOutAllDevices()}
              revokingId={revokeSession.isPending ? (revokeSession.variables?.id ?? null) : null}
              onRetry={() => void sessionsQuery.refetch()}
              config={config}
              locale={locale}
            />
          </div>
          {sortedSessions.length > 5 && (
            <Button
              type="button"
              variant="ghost"
              className="mt-1 w-full md:w-auto"
              aria-expanded={showAllDevices}
              onClick={() => setShowAllDevices((value) => !value)}
            >
              {showAllDevices ? (
                <ChevronUpIcon className="size-4" aria-hidden="true" />
              ) : (
                <ChevronDownIcon className="size-4" aria-hidden="true" />
              )}
              {showAllDevices
                ? t('account.devices.showFewer')
                : t('account.devices.showAll', { count: sortedSessions.length })}
            </Button>
          )}
        </section>
      </Card>

      <CalendarFeedCard />

      <Button
        type="button"
        variant="outline"
        loading={signingOut}
        onClick={() => void handleSignOut()}
        className="w-full md:w-auto md:self-start"
      >
        <LogOutIcon className="size-4" aria-hidden="true" />
        {signingOut ? t('account.signOut.signingOut') : t('account.signOut.action')}
      </Button>
    </PageContainer>
  );
}

/** One email / phone line: field name, value, a verified / unverified badge
 * and a Change (or Add, when empty) button. Kept a single `div` holding both
 * the value and the button — the e2e `rowFor` relies on that. */
function ContactRow({
  icon,
  label,
  value,
  verifiedAt,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  verifiedAt: string | null;
  onChange: () => void;
}) {
  const { t } = useTranslation('portal');
  const config = useRegionConfig();

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
      <span className="shrink-0 text-text-secondary">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-caption text-text-secondary">{label}</p>
        {value ? (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium break-all">{value}</span>
            {verifiedAt ? (
              <span
                title={t('account.contact.verified', {
                  date: formatDate(new Date(verifiedAt), config),
                })}
              >
                <StatusBadge tone="success" label={t('account.contact.verifiedShort')} />
              </span>
            ) : (
              <StatusBadge tone="warning" label={t('account.contact.unverified')} />
            )}
          </p>
        ) : (
          <p className="text-text-secondary">{t('account.contact.none')}</p>
        )}
      </div>
      <Button
        type="button"
        variant="outline"
        aria-label={`${value ? t('account.contact.change') : t('account.contact.add')} ${label}`}
        onClick={onChange}
      >
        {!value && <PlusIcon className="size-4" aria-hidden="true" />}
        {value ? t('account.contact.change') : t('account.contact.add')}
      </Button>
    </div>
  );
}

function AccountSkeleton({ label, showGuardian }: { label: string; showGuardian: boolean }) {
  return (
    // No `<h1>` while pending — see this file's own header table.
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div className="flex flex-col gap-0.5">
        <Skeleton className="h-9 w-2/5" />
        <Skeleton className="h-5 w-3/5" />
      </div>
      <Skeleton className="h-48 w-full rounded-lg" />
      {showGuardian && <Skeleton className="h-56 w-full rounded-lg" />}
      <Skeleton className="h-44 w-full rounded-lg" />
      <Skeleton className="h-32 w-full rounded-lg" />
    </div>
  );
}
