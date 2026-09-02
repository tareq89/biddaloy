import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  Card,
  ChangePasswordForm,
  ErrorState,
  GuardianContactForm,
  LocaleSwitcher,
  ProfileForm,
  Skeleton,
  ThemeToggle,
  toast,
  type ChangePasswordFormServerError,
  type GuardianContactFormServerError,
  type GuardianContactFormValues,
  type ProfileFormServerError,
  type ProfileFormSubmitValues,
} from '@biddaloy/ui/components';
import {
  changePassword,
  logout,
  myGuardianQueryOptions,
  useActiveRole,
  useCurrentUser,
  useUpdateMyGuardian,
  useUpdateOwnProfile,
} from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { parseValidationFieldErrors } from '@biddaloy/ui/utils';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { LogOutIcon } from 'lucide-react';
import * as React from 'react';

/**
 * [8.14.4] `/portal/account` — the first screen anywhere to consume the
 * three self-service endpoints phase 5 shipped: `PATCH /users/me`,
 * `GET`/`PATCH /guardians/mine`, and `POST /auth/change-password`. Plus
 * language, theme, and **sign-out inside the portal** (today the only way
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
const PROFILE_FIELDS = ['full_name', 'email', 'phone', 'current_password'] as const;
const GUARDIAN_FIELDS = ['phone', 'alternate_phone', 'email'] as const;

function PortalAccount() {
  const { t } = useTranslation('portal');
  const config = useRegionConfig();
  const role = useActiveRole();
  const isParent = role === 'PARENT';
  const queryClient = useQueryClient();
  const navigate = useNavigate();

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

  const [profileError, setProfileError] = React.useState<ProfileFormServerError | null>(null);
  const [guardianError, setGuardianError] = React.useState<GuardianContactFormServerError | null>(
    null,
  );
  const [passwordError, setPasswordError] = React.useState<ChangePasswordFormServerError | null>(
    null,
  );
  const [changingPassword, setChangingPassword] = React.useState(false);
  const [signingOut, setSigningOut] = React.useState(false);

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
      {
        full_name: values.full_name,
        email: values.email,
        phone: values.phone,
        ...(values.current_password ? { current_password: values.current_password } : {}),
      },
      {
        onSuccess: () => toast.success(t('account.profile.saved')),
        onError: (error) => {
          if (error instanceof ApiError && error.statusCode === 403) {
            setProfileError({
              fieldErrors: { current_password: t('account.profile.errors.wrongPassword') },
            });
            return;
          }
          if (error instanceof ApiError && error.statusCode === 409) {
            setProfileError({ message: t('account.profile.errors.conflict') });
            return;
          }
          if (error instanceof ApiError && error.statusCode === 400) {
            setProfileError({
              fieldErrors: parseValidationFieldErrors(error.messages, PROFILE_FIELDS),
            });
            return;
          }
          setProfileError({ message: t('account.error.message') });
        },
      },
    );
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
          setGuardianError({ message: t('account.error.message') });
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
        setPasswordError({ message: t('account.error.message') });
      }
    } finally {
      setChangingPassword(false);
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

  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <h1 className="text-lg font-semibold tracking-tight">{t('account.title')}</h1>

      <ProfileForm
        defaultValues={{
          full_name: currentUser.full_name,
          email: currentUser.email ?? '',
          phone: currentUser.phone ?? '',
        }}
        onSubmit={handleProfileSubmit}
        submitting={updateProfile.isPending}
        serverError={profileError}
      />

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

      <Card className="flex flex-col gap-3 p-4">
        <h2 className="text-sm font-semibold">{t('account.preferences.title')}</h2>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">{t('account.preferences.language')}</span>
          <LocaleSwitcher />
        </div>
        {/* [8.14.4] plan correction 9 — the header already carries a
            `ThemeToggle` ([8.14.2]'s `portal.tsx:96`). This is a second,
            discoverable instance inside the account surface itself; both
            read/write the same `theme-provider` state, so they never
            diverge. Do not remove the header instance here — that is
            [8.14.2]'s territory. */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">{t('account.preferences.theme')}</span>
          <ThemeToggle />
        </div>
      </Card>

      <Button
        type="button"
        variant="outline"
        loading={signingOut}
        onClick={() => void handleSignOut()}
        className="self-start"
      >
        <LogOutIcon className="size-4" aria-hidden="true" />
        {signingOut ? t('account.signOut.signingOut') : t('account.signOut.action')}
      </Button>
    </div>
  );
}

function AccountSkeleton({ label, showGuardian }: { label: string; showGuardian: boolean }) {
  return (
    // No `<h1>` while pending — see this file's own header table.
    <div className="flex max-w-2xl flex-col gap-3" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-7 w-2/5" />
      <Skeleton className="h-48 w-full rounded-lg" />
      {showGuardian && <Skeleton className="h-56 w-full rounded-lg" />}
      <Skeleton className="h-44 w-full rounded-lg" />
      <Skeleton className="h-32 w-full rounded-lg" />
    </div>
  );
}
