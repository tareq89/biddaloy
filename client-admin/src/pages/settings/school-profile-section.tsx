import { apiClient, getActiveRole } from '@biddaloy/ui/api';
import {
  Button,
  ConfirmDialog,
  ErrorState,
  FileUpload,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
} from '@biddaloy/ui/components';
import {
  useRemoveSchoolLogo,
  useSchoolProfile,
  useUpdateSchoolProfile,
  useUploadSchoolLogo,
  type SchoolProfile,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { useFormShellMode, useWarnUnsavedChanges } from '@biddaloy/ui/shells';
import { formatPhone } from '@biddaloy/ui/utils';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { SettingsSaved, SettingsSection } from './settings-layout';
import { SettingsMutationError } from './settings-mutation-error';

const LOGO_MAX_BYTES = 512 * 1024;
const LOGO_ACCEPT = 'image/png,image/jpeg,image/webp';

const profileSchema = z.object({
  name: z.string().min(1),
  name_bn: z.string(),
  address: z.string(),
  phone: z.string(),
  email: z.email().or(z.literal('')),
  registration_id: z.string(),
});

type ProfileFormValues = z.infer<typeof profileSchema>;

/**
 * [15.5.4]/[15.5.6] `logo_url` (`/schools/:id/logo?v=<uuid>`) needs the
 * bearer token `GET /schools/:id/logo` requires — a bare `<img src>` sends
 * no `Authorization` header and 401s. `useQuery` fetches the bytes through
 * the authenticated API client (cache-first, same retry/403 handling as
 * every other query — the repo's `no-fetch-in-effect` lint rule requires
 * this over a raw `useEffect` fetch); a second, fetch-free `useEffect`
 * only turns the resulting `Blob` into an object URL and revokes the
 * previous one, since `URL.createObjectURL` has no query equivalent.
 */
function useAuthenticatedImageUrl(url: string | null | undefined): string | null {
  const blobQuery = useQuery({
    queryKey: ['authenticated-image', url],
    queryFn: async () => (await apiClient.get<Blob>(url!, { responseType: 'blob' })).data,
    enabled: url != null,
  });

  const [objectUrl, setObjectUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!blobQuery.data) {
      setObjectUrl(null);
      return;
    }
    const created = URL.createObjectURL(blobQuery.data);
    setObjectUrl(created);
    return () => URL.revokeObjectURL(created);
  }, [blobQuery.data]);

  return objectUrl;
}

function toFormValues(profile: SchoolProfile | undefined): ProfileFormValues {
  return {
    name: profile?.name ?? '',
    name_bn: profile?.name_bn ?? '',
    address: profile?.address ?? '',
    phone: profile?.phone ?? '',
    email: profile?.email ?? '',
    registration_id: profile?.registration_id ?? '',
  };
}

/**
 * [15.5.6] First section on the Settings page: the school's identity
 * (name in English and Bengali, address, phone, email, EIIN) and its
 * logo. RHF + `SettingsSection` (31.4 settings-1b): one card, saved
 * independently of everything else on the page.
 *
 * Read-only for anyone who isn't ADMIN/SUPER_ADMIN: the six text fields
 * render as plain values (no inputs, no save button), and the logo
 * upload/remove controls don't render at all — matches the server's own
 * `@Roles(ADMIN, SUPER_ADMIN)` gate on `PATCH /schools/me/profile` and
 * `POST/DELETE /schools/me/logo` ([15.5.2]/[15.5.3]).
 */
export function SchoolProfileSection() {
  const { t } = useTranslation('settings');
  const role = getActiveRole();
  const canEdit = role === 'ADMIN' || role === 'SUPER_ADMIN';

  const profileQuery = useSchoolProfile();
  const updateProfile = useUpdateSchoolProfile();

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: toFormValues(profileQuery.data),
    ...useFormShellMode(),
  });

  // Re-seed the form once the profile actually loads — `defaultValues` at
  // construction time ran before the query had data on first mount. Only
  // when the form is pristine: a later refetch (e.g. `useUploadSchoolLogo`
  // invalidating this same query after a logo change) must not discard
  // text-field edits the user hasn't saved yet.
  React.useEffect(() => {
    if (profileQuery.data && !form.formState.isDirty) {
      form.reset(toFormValues(profileQuery.data));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileQuery.data]);

  // `isDirty` alone: `.mutate()` is not awaited, so `isSubmitSuccessful` would silence the
  // warning after a failed save. `onSuccess` resets the form, which clears `isDirty`.
  useWarnUnsavedChanges(form.formState.isDirty);

  function handleSave(values: ProfileFormValues) {
    updateProfile.mutate(
      {
        name: values.name,
        name_bn: values.name_bn || null,
        address: values.address || null,
        phone: values.phone || null,
        email: values.email || null,
        registration_id: values.registration_id || null,
      },
      {
        onSuccess: () => {
          form.reset(values, { keepIsSubmitSuccessful: true });
        },
      },
    );
  }

  if (profileQuery.isError) {
    return (
      <SettingsSection id="profile-section" title={t('profile.legend')}>
        <div className="mt-4">
          <ErrorState
            message={t('profile.loadError')}
            onRetry={() => void profileQuery.refetch()}
          />
        </div>
      </SettingsSection>
    );
  }

  // Wait for the first successful load before rendering the form/read-only
  // view — otherwise RHF's `defaultValues` (computed at construction time,
  // before the query resolves) would render an empty field that only
  // catches up once the `useEffect` above re-seeds it, a visible flash a
  // test asserting on the loaded value would otherwise have to race.
  if (!profileQuery.data) {
    return (
      <SettingsSection id="profile-section" title={t('profile.legend')}>
        <div className="mt-4 space-y-3" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      </SettingsSection>
    );
  }

  if (!canEdit) {
    const profile = profileQuery.data;
    return <ReadOnlyProfile profile={profile} t={t} />;
  }

  const field = (
    name: keyof ProfileFormValues,
    label: string,
    extra?: { type?: string; wide?: boolean },
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field: f }) => (
        <FormItem className={extra?.wide ? 'md:col-span-2' : undefined}>
          <FormLabel htmlFor={`profile-${name}`}>{label}</FormLabel>
          <FormControl>
            <Input id={`profile-${name}`} type={extra?.type} {...f} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <Form {...form}>
      <SettingsSection
        id="profile-section"
        title={t('profile.legend')}
        description={t('profile.description')}
        onSubmit={(event) => void form.handleSubmit(handleSave)(event)}
        saving={updateProfile.isPending}
        footerStart={
          <>
            {updateProfile.isSuccess && <SettingsSaved />}
            {updateProfile.isError && <SettingsMutationError error={updateProfile.error} />}
          </>
        }
      >
        <SchoolLogoField logoUrl={profileQuery.data?.logo_url} />

        <div className="mt-4 grid gap-4 border-t border-border-subtle pt-4 md:grid-cols-2">
          {field('name', t('profile.name'))}
          {field('name_bn', t('profile.nameBn'))}
          {field('phone', t('profile.phone'))}
          {field('email', t('profile.email'), { type: 'email' })}
          {field('registration_id', t('profile.registrationId'))}
          {field('address', t('profile.address'), { wide: true })}
        </div>
      </SettingsSection>
    </Form>
  );
}

/**
 * [13.5.4] The logo row (preview, upload, remove + confirm), exported so the guided
 * onboarding setup shows the exact same control. Own state, own mutations.
 */
export function SchoolLogoField({ logoUrl }: { logoUrl: string | null | undefined }) {
  const { t } = useTranslation('settings');
  const uploadLogo = useUploadSchoolLogo();
  const removeLogo = useRemoveSchoolLogo();
  const [logoError, setLogoError] = React.useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = React.useState(false);

  // `FileUpload` already resets its own `<input>` after each pick, so the
  // same file can be re-chosen after a failed upload.
  function handleFilesSelected(files: File[]) {
    const file = files[0];
    if (!file) return;

    setLogoError(null);
    if (file.size > LOGO_MAX_BYTES) {
      // Client-side pre-check of size only — the server is the authority
      // on format/dimensions ([15.5.3]'s own contract), so this is purely
      // a fast "don't even bother uploading" guard.
      setLogoError(t('profile.logo.tooLarge'));
      return;
    }

    uploadLogo.mutate(file, {
      onError: () => setLogoError(t('profile.logo.uploadError')),
    });
  }

  function handleRemove() {
    setLogoError(null);
    removeLogo.mutate(undefined, {
      onSuccess: () => setConfirmingRemove(false),
      // The dialog has no error slot: close it and say so under the logo row.
      onError: () => {
        setConfirmingRemove(false);
        setLogoError(t('profile.logo.removeError'));
      },
    });
  }

  const logoObjectUrl = useAuthenticatedImageUrl(logoUrl);

  // Upload and remove are mutually exclusive while either is in flight:
  // both target the same logo, and letting them overlap would leave the
  // final state up to whichever response lands last.
  const logoBusy = uploadLogo.isPending || removeLogo.isPending;

  return (
    <>
      <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
        {logoObjectUrl ? (
          <img
            src={logoObjectUrl}
            alt={t('profile.logo.alt')}
            className="size-16 rounded-md border border-border-subtle object-contain"
          />
        ) : (
          <div
            role="img"
            aria-label={t('profile.logo.empty')}
            className="size-16 rounded-md border border-border-subtle bg-muted"
          />
        )}
        <div className="min-w-0">
          <p className="font-medium">{t('profile.logo.legend')}</p>
          <p className="text-caption text-text-secondary">{t('profile.logo.help')}</p>
        </div>
        <div className="flex flex-col gap-2 md:ms-auto md:flex-row">
          {/* The shared `FileUpload` (sr-only native input + a real `Button`)
                rather than a bare `<input type="file">`: the native control
                fails the 320px reflow and 24x24 target-size gates (e2e/responsive/*).
                `items` stays empty: the preview is the "selected file" state. */}
          <FileUpload
            items={[]}
            onFilesSelected={handleFilesSelected}
            accept={LOGO_ACCEPT}
            multiple={false}
            disabled={logoBusy}
            aria-label={t('profile.logo.upload')}
            chooseLabel={t('profile.logo.upload')}
          />
          {logoUrl && (
            <Button
              type="button"
              variant="ghost"
              disabled={logoBusy}
              onClick={() => setConfirmingRemove(true)}
              className="w-full md:w-auto"
            >
              {t('profile.logo.remove')}
            </Button>
          )}
        </div>
      </div>
      {uploadLogo.isPending && (
        <p role="status" className="mt-2 text-caption text-text-secondary">
          {t('profile.logo.uploading')}
        </p>
      )}
      {logoError && (
        <p role="alert" className="mt-2 text-destructive">
          {logoError}
        </p>
      )}

      <ConfirmDialog
        open={confirmingRemove}
        onOpenChange={setConfirmingRemove}
        title={t('profile.logo.removeConfirm')}
        description={t('profile.logo.removeConfirmDescription')}
        confirmLabel={t('profile.logo.removeConfirmYes')}
        cancelLabel={t('profile.logo.removeCancel')}
        tone="danger"
        busy={removeLogo.isPending}
        onConfirm={handleRemove}
      />
    </>
  );
}

function ReadOnlyProfile({
  profile,
  t,
}: {
  profile: SchoolProfile | undefined;
  t: (key: string) => string;
}) {
  const logoObjectUrl = useAuthenticatedImageUrl(profile?.logo_url);
  const regionConfig = useRegionConfig();

  return (
    <SettingsSection id="profile-section" title={t('profile.legend')}>
      {logoObjectUrl && (
        <img
          src={logoObjectUrl}
          alt={t('profile.logo.alt')}
          className="mt-4 size-16 rounded-md border border-border-subtle object-contain"
        />
      )}
      <dl className="mt-4 grid gap-4 md:grid-cols-2">
        <ReadOnlyRow label={t('profile.name')} value={profile?.name} />
        <ReadOnlyRow label={t('profile.nameBn')} value={profile?.name_bn} />
        <ReadOnlyRow
          label={t('profile.phone')}
          value={profile?.phone ? formatPhone(profile.phone, regionConfig) : undefined}
        />
        <ReadOnlyRow label={t('profile.email')} value={profile?.email} />
        <ReadOnlyRow label={t('profile.registrationId')} value={profile?.registration_id} />
        <ReadOnlyRow label={t('profile.address')} value={profile?.address} />
      </dl>
    </SettingsSection>
  );
}

function ReadOnlyRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-caption text-text-secondary">{label}</dt>
      <dd className="font-medium">{value || '—'}</dd>
    </div>
  );
}
