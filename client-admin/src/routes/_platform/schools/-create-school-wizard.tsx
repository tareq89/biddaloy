/**
 * Presentational half of #534's create-school wizard — pulled out of
 * `new.tsx` for the same reason `-schools-list-view.tsx` is split from
 * #533's `index.tsx`: storyable (`-create-school-wizard.stories.tsx`)
 * without a router or a live `useProvisionSchool()` mutation.
 *
 * Two RHF forms, not one: `School` step (name/slug) and `Admin` step
 * (name/email-or-phone) validate independently as the wizard's own two
 * `Zod` schemas mirror the server's two DTOs
 * (`ProvisionSchoolDto`/`ProvisionSchoolAdminDto`, see
 * `provision-school.dto.ts`). Submitting step 2 is what actually calls
 * `onSubmit` with both steps' values combined — step 1 only ever
 * advances `step` state, no request goes out until the admin step is
 * valid too.
 */
import {
  Button,
  Card,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
} from '@biddaloy/ui/components';
import type { ProvisionSchoolResult } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { FormSection, FormShell, buildFormShellErrors } from '@biddaloy/ui/shells';
import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { RestoreWizard } from '../../../pages/settings/restore-wizard';

/** Mirrors `ProvisionSchoolDto`'s own top-level `name`/`slug` fields
 * (`server/src/modules/schools/provisioning/dto/provision-school.dto.ts`) —
 * same `MaxLength` bounds, kept in sync by hand since this DTO has no
 * generated client type (see `ProvisionSchoolInput`'s own comment in
 * `school-settings.ts`). Slug pattern matches what `slugify()` below
 * produces, so an edited slug that strays from that shape is caught
 * client-side instead of round-tripping to the server's own validation. */
const schoolStepSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
      message: 'Lowercase letters, numbers, and single hyphens only.',
    }),
});

/** Mirrors `ProvisionSchoolAdminDto` — `email`/`phone` are each optional
 * individually, but `superRefine` enforces the DTO's actual constraint
 * ("at least one of email/phone", `provision-school.dto.ts`'s own class
 * comment) since Zod's object schema alone can't express an either/or
 * across two independent optional fields. */
const adminStepSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    email: z.string().trim().max(100).optional().or(z.literal('')),
    phone: z.string().trim().max(20).optional().or(z.literal('')),
  })
  .superRefine((values, ctx) => {
    if (!values.email && !values.phone) {
      const message = 'Provide an email or a phone number.';
      ctx.addIssue({ code: 'custom', path: ['email'], message });
      ctx.addIssue({ code: 'custom', path: ['phone'], message });
    } else if (values.email) {
      const emailCheck = z.email().safeParse(values.email);
      if (!emailCheck.success) {
        ctx.addIssue({ code: 'custom', path: ['email'], message: 'Enter a valid email address.' });
      }
    }
  });

export type SchoolStepValues = z.infer<typeof schoolStepSchema>;
export type AdminStepValues = z.infer<typeof adminStepSchema>;

/** name -> slug: lowercase, non-alphanumeric runs become a single `-`,
 * leading/trailing `-` trimmed. Applied only while the slug field hasn't
 * been hand-edited yet (`new.tsx` tracks that) — see this file's own
 * `CreateSchoolWizard` doc for why the suggestion stops once a user
 * types into the slug field directly. */
export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export type CreateSchoolStep = 'school' | 'admin' | 'success';

export interface CreateSchoolWizardProps {
  step: CreateSchoolStep;
  schoolDefaults: SchoolStepValues;
  adminDefaults: AdminStepValues;
  submitting: boolean;
  /** Set only on a 409 slug conflict — everything else surfaces via
   * `submitError` instead (see `new.tsx`'s error-branch comment). */
  slugConflict?: string;
  /** Any non-409 failure from the last submit attempt. */
  submitError?: string;
  result?: ProvisionSchoolResult;
  /** [14.13.3] The school-step name typed for this school — carried through
   * to the success step purely to feed `RestoreWizard`'s `expectedSchoolName`
   * confirmation gate (the new school isn't `new.tsx`'s SUPER_ADMIN's own
   * active tenant, so `useSchoolProfile()` can't resolve it there). */
  schoolName?: string;
  onSchoolNext: (values: SchoolStepValues) => void;
  onAdminBack: () => void;
  onAdminSubmit: (values: AdminStepValues) => void;
  renderDetailLink: (schoolId: string) => React.ReactNode;
}

export function CreateSchoolWizard({
  step,
  schoolDefaults,
  adminDefaults,
  submitting,
  slugConflict,
  submitError,
  result,
  schoolName,
  onSchoolNext,
  onAdminBack,
  onAdminSubmit,
  renderDetailLink,
}: CreateSchoolWizardProps) {
  const { t } = useTranslation('platform');

  if (step === 'success' && result) {
    return (
      <Card className="mx-auto max-w-lg p-6">
        <h1 className="text-lg font-semibold">{t('createWizard.successTitle')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('createWizard.successInvitation', { status: result.invitation.status })}
        </p>
        <div className="mt-4">{renderDetailLink(result.school.id)}</div>
        <ImportWorkbookSection tenantId={result.school.id} expectedSchoolName={schoolName ?? ''} />
      </Card>
    );
  }

  if (step === 'admin') {
    return (
      <AdminStepForm
        defaults={adminDefaults}
        submitting={submitting}
        {...(submitError !== undefined ? { submitError } : {})}
        onBack={onAdminBack}
        onSubmit={onAdminSubmit}
      />
    );
  }

  return (
    <SchoolStepForm
      defaults={schoolDefaults}
      {...(slugConflict !== undefined ? { slugConflict } : {})}
      onNext={onSchoolNext}
    />
  );
}

function SchoolStepForm({
  defaults,
  slugConflict,
  onNext,
}: {
  defaults: SchoolStepValues;
  slugConflict?: string;
  onNext: (values: SchoolStepValues) => void;
}) {
  const { t } = useTranslation('platform');
  const form = useForm<SchoolStepValues>({
    resolver: zodResolver(schoolStepSchema),
    defaultValues: defaults,
  });

  // The slug only auto-follows the name until the slug field itself is
  // hand-edited — flips permanently false on the slug input's own
  // onChange below, so a later name edit never clobbers a deliberate
  // slug the admin already typed.
  const slugTouched = React.useRef(
    defaults.slug !== '' && defaults.slug !== slugify(defaults.name),
  );

  // A slug conflict from the server (#409) is a field-level error just
  // like a client-side validation failure — `setError` puts it in the
  // same `formState.errors` the summary/FormMessage already render from,
  // rather than a separate error banner.
  React.useEffect(() => {
    if (slugConflict) {
      form.setError('slug', { type: 'server', message: slugConflict });
    }
  }, [slugConflict, form]);

  const summaryErrors = buildFormShellErrors(
    form.formState.errors,
    (field) => `create-school-${field}`,
  );

  return (
    <Card className="mx-auto max-w-lg p-6">
      <h1 className="mb-4 text-lg font-semibold">{t('createWizard.schoolStepTitle')}</h1>
      <Form {...form}>
        <FormShell
          errors={summaryErrors}
          submitCount={form.formState.submitCount}
          onSubmit={(event) => void form.handleSubmit(onNext)(event)}
        >
          <FormSection legend={t('createWizard.schoolStepTitle')}>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="create-school-name">{t('createWizard.nameLabel')}</FormLabel>
                  <FormControl>
                    <Input
                      id="create-school-name"
                      {...field}
                      onChange={(event) => {
                        field.onChange(event);
                        if (!slugTouched.current) {
                          form.setValue('slug', slugify(event.target.value));
                        }
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="slug"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="create-school-slug">{t('createWizard.slugLabel')}</FormLabel>
                  <FormControl>
                    <Input
                      id="create-school-slug"
                      {...field}
                      onChange={(event) => {
                        slugTouched.current = true;
                        field.onChange(event);
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </FormSection>
          <Button type="submit">{t('createWizard.nextAction')}</Button>
        </FormShell>
      </Form>
    </Card>
  );
}

/** [14.13.3] Collapsed by default — importing a workbook right after
 * create is optional (D8's "confirm to do the irreversible thing on
 * purpose" already lives inside `RestoreWizard` itself; this is just the
 * entry point into it). `expectedSchoolName` empty (e.g. `schoolName` was
 * never passed) fails the confirmation gate closed, same as
 * `RestoreWizard`'s own fail-closed default — never silently skips it. */
function ImportWorkbookSection({
  tenantId,
  expectedSchoolName,
}: {
  tenantId: string;
  expectedSchoolName: string;
}) {
  const { t } = useTranslation('platform');
  const [open, setOpen] = React.useState(false);

  return (
    <div className="mt-4 border-t border-border-subtle pt-4">
      <Button type="button" variant="ghost" onClick={() => setOpen((prev) => !prev)}>
        {t('createWizard.importWorkbookToggle')}
      </Button>
      {open && (
        <div className="mt-3 flex flex-col gap-3">
          {/* [item 4, money-tier review] Explicit warning: a restore
           * REPLACES this new school's data, and the just-sent admin
           * invitation is exempt from removal but every other membership in
           * the imported workbook is not — this is not "add more data,"
           * it's "make this school look like the workbook." */}
          <p className="text-sm font-medium text-destructive">
            {t('createWizard.importWorkbookWarning')}
          </p>
          <RestoreWizard tenantId={tenantId} expectedSchoolName={expectedSchoolName} />
        </div>
      )}
    </div>
  );
}

function AdminStepForm({
  defaults,
  submitting,
  submitError,
  onBack,
  onSubmit,
}: {
  defaults: AdminStepValues;
  submitting: boolean;
  submitError?: string;
  onBack: () => void;
  onSubmit: (values: AdminStepValues) => void;
}) {
  const { t } = useTranslation('platform');
  const form = useForm<AdminStepValues>({
    resolver: zodResolver(adminStepSchema),
    defaultValues: defaults,
  });

  const summaryErrors = buildFormShellErrors(
    form.formState.errors,
    (field) => `create-school-admin-${field}`,
  );

  return (
    <Card className="mx-auto max-w-lg p-6">
      <h1 className="mb-4 text-lg font-semibold">{t('createWizard.adminStepTitle')}</h1>
      <Form {...form}>
        <FormShell
          errors={summaryErrors}
          submitCount={form.formState.submitCount}
          onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}
        >
          <FormSection legend={t('createWizard.adminStepTitle')}>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="create-school-admin-name">
                    {t('createWizard.adminNameLabel')}
                  </FormLabel>
                  <FormControl>
                    <Input id="create-school-admin-name" {...field} />
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
                  <FormLabel htmlFor="create-school-admin-email">
                    {t('createWizard.adminEmailLabel')}
                  </FormLabel>
                  <FormControl>
                    <Input id="create-school-admin-email" type="email" {...field} />
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
                  <FormLabel htmlFor="create-school-admin-phone">
                    {t('createWizard.adminPhoneLabel')}
                  </FormLabel>
                  <FormControl>
                    <Input id="create-school-admin-phone" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </FormSection>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={onBack} disabled={submitting}>
              {t('createWizard.backAction')}
            </Button>
            <Button type="submit" loading={submitting}>
              {t('createWizard.submitAction')}
            </Button>
          </div>
          {submitError && (
            <p role="alert" className="text-sm text-destructive">
              {submitError}
            </p>
          )}
        </FormShell>
      </Form>
    </Card>
  );
}
