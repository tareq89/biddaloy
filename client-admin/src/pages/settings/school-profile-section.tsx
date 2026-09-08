import { apiClient, getActiveRole } from '@biddaloy/ui/api';
import {
  Button,
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
import { useTranslation } from '@biddaloy/ui/i18n';
import {
  FormSection,
  FormShell,
  buildFormShellErrors,
  useFormShellMode,
  useWarnUnsavedChanges,
} from '@biddaloy/ui/shells';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { MutationErrorMessage } from '../../components/MutationErrorMessage';

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
 * logo. Same RHF + `FormShell` grammar as every other settings section
 * (`SignInSection.tsx` is the simplest reference) — one section, one
 * `FormShell`, saved independently of everything else on the page.
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
  const uploadLogo = useUploadSchoolLogo();
  const removeLogo = useRemoveSchoolLogo();

  const [logoError, setLogoError] = React.useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

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

  useWarnUnsavedChanges(form.formState.isDirty && !form.formState.isSubmitSuccessful);

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

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
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
    removeLogo.mutate(undefined, {
      onSuccess: () => setConfirmingRemove(false),
    });
  }

  const logoObjectUrl = useAuthenticatedImageUrl(profileQuery.data?.logo_url);

  const summaryErrors = buildFormShellErrors(form.formState.errors, (field) => `profile-${field}`);

  if (profileQuery.isError) {
    return (
      <FormSection legend={t('profile.legend')}>
        <p role="alert" className="text-sm text-destructive">
          {t('profile.loadError')}
        </p>
      </FormSection>
    );
  }

  // Wait for the first successful load before rendering the form/read-only
  // view — otherwise RHF's `defaultValues` (computed at construction time,
  // before the query resolves) would render an empty field that only
  // catches up once the `useEffect` above re-seeds it, a visible flash a
  // test asserting on the loaded value would otherwise have to race.
  if (!profileQuery.data) {
    return <FormSection legend={t('profile.legend')}>{null}</FormSection>;
  }

  if (!canEdit) {
    const profile = profileQuery.data;
    return <ReadOnlyProfile profile={profile} t={t} />;
  }

  return (
    <Form {...form}>
      <FormShell
        errors={summaryErrors}
        submitCount={form.formState.submitCount}
        onSubmit={(event) => void form.handleSubmit(handleSave)(event)}
      >
        <FormSection legend={t('profile.legend')}>
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="profile-name">{t('profile.name')}</FormLabel>
                <FormControl>
                  <Input id="profile-name" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="name_bn"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="profile-name_bn">{t('profile.nameBn')}</FormLabel>
                <FormControl>
                  <Input id="profile-name_bn" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="address"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="profile-address">{t('profile.address')}</FormLabel>
                <FormControl>
                  <Input id="profile-address" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="profile-phone">{t('profile.phone')}</FormLabel>
                <FormControl>
                  <Input id="profile-phone" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="profile-email">{t('profile.email')}</FormLabel>
                <FormControl>
                  <Input id="profile-email" type="email" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="registration_id"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="profile-registration_id">
                  {t('profile.registrationId')}
                </FormLabel>
                <FormControl>
                  <Input id="profile-registration_id" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </FormSection>

        <FormSection legend={t('profile.logo.legend')}>
          <div className="flex items-center gap-4">
            {logoObjectUrl ? (
              <img
                src={logoObjectUrl}
                alt={t('profile.logo.alt')}
                className="h-16 w-16 rounded border border-border object-contain"
              />
            ) : (
              <div
                role="img"
                aria-label={t('profile.logo.empty')}
                className="flex h-16 w-16 items-center justify-center rounded border border-dashed border-border text-xs text-muted-foreground"
              >
                {t('profile.logo.empty')}
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <input
                ref={fileInputRef}
                type="file"
                accept={LOGO_ACCEPT}
                aria-label={t('profile.logo.upload')}
                onChange={handleFileChange}
                className="text-sm"
              />
              {uploadLogo.isPending && (
                <p role="status" className="text-xs text-muted-foreground">
                  {t('profile.logo.uploading')}
                </p>
              )}
              {logoError && (
                <p role="alert" className="text-sm text-destructive">
                  {logoError}
                </p>
              )}

              {profileQuery.data?.logo_url && !confirmingRemove && (
                <Button type="button" variant="outline" onClick={() => setConfirmingRemove(true)}>
                  {t('profile.logo.remove')}
                </Button>
              )}
              {confirmingRemove && (
                <div className="flex items-center gap-2">
                  <span className="text-sm">{t('profile.logo.removeConfirm')}</span>
                  <Button
                    type="button"
                    variant="destructive"
                    loading={removeLogo.isPending}
                    onClick={handleRemove}
                  >
                    {t('profile.logo.removeConfirmYes')}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setConfirmingRemove(false)}>
                    {t('profile.logo.removeCancel')}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </FormSection>

        <Button type="submit" loading={updateProfile.isPending}>
          {t('save.action')}
        </Button>
        {updateProfile.isSuccess && <p role="status">{t('save.success')}</p>}
        {updateProfile.isError && <MutationErrorMessage error={updateProfile.error} />}
      </FormShell>
    </Form>
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

  return (
    <FormSection legend={t('profile.legend')}>
      <dl className="grid gap-2 text-sm">
        <ReadOnlyRow label={t('profile.name')} value={profile?.name} />
        <ReadOnlyRow label={t('profile.nameBn')} value={profile?.name_bn} />
        <ReadOnlyRow label={t('profile.address')} value={profile?.address} />
        <ReadOnlyRow label={t('profile.phone')} value={profile?.phone} />
        <ReadOnlyRow label={t('profile.email')} value={profile?.email} />
        <ReadOnlyRow label={t('profile.registrationId')} value={profile?.registration_id} />
      </dl>
      {logoObjectUrl && (
        <img
          src={logoObjectUrl}
          alt={t('profile.logo.alt')}
          className="mt-2 h-16 w-16 rounded object-contain"
        />
      )}
    </FormSection>
  );
}

function ReadOnlyRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex gap-2">
      <dt className="font-medium text-muted-foreground">{label}</dt>
      <dd>{value || '—'}</dd>
    </div>
  );
}
