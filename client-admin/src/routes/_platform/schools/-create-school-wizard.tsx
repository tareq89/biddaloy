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
import type { InvitationStatus } from '@biddaloy/shared';
import {
  Button,
  Card,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  StatusBadge,
} from '@biddaloy/ui/components';
import type { ProvisionSchoolResult } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { zodResolver } from '@hookform/resolvers/zod';
import { CircleAlertIcon } from 'lucide-react';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { RestoreWizard } from '../../../pages/settings/restore-wizard';

export interface SchoolStepValues {
  name: string;
  slug: string;
}
export interface AdminStepValues {
  name: string;
  email?: string | undefined;
  phone?: string | undefined;
}

type TFn = (key: string) => string;

/** Mirrors `ProvisionSchoolDto`'s own top-level `name`/`slug` fields
 * (`server/src/modules/schools/provisioning/dto/provision-school.dto.ts`) —
 * same `MaxLength` bounds, kept in sync by hand since this DTO has no
 * generated client type. Slug pattern matches what `slugify()` below
 * produces. Built from `t` so every message is translated (D9). */
function buildSchoolStepSchema(tr: TFn) {
  const required = tr('createWizard.errors.required');
  return z.object({
    name: z.string().trim().min(1, required).max(200),
    slug: z
      .string()
      .trim()
      .min(1, required)
      .max(100)
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, { message: tr('createWizard.errors.slugPattern') }),
  });
}

/** Mirrors `ProvisionSchoolAdminDto` — `email`/`phone` are each optional
 * individually, but `superRefine` enforces the DTO's actual constraint
 * ("at least one of email/phone"). */
function buildAdminStepSchema(tr: TFn) {
  return z
    .object({
      name: z.string().trim().min(1, tr('createWizard.errors.required')).max(100),
      email: z.string().trim().max(100).optional().or(z.literal('')),
      phone: z.string().trim().max(20).optional().or(z.literal('')),
    })
    .superRefine((values, ctx) => {
      if (!values.email && !values.phone) {
        const message = tr('createWizard.errors.contactRequired');
        ctx.addIssue({ code: 'custom', path: ['email'], message });
        ctx.addIssue({ code: 'custom', path: ['phone'], message });
      } else if (values.email && !z.email().safeParse(values.email).success) {
        ctx.addIssue({
          code: 'custom',
          path: ['email'],
          message: tr('createWizard.errors.emailInvalid'),
        });
      }
    });
}

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
  result?: ProvisionSchoolResult;
  /** [14.13.3] The school-step name typed for this school — carried through
   * to the success step purely to feed `RestoreWizard`'s `expectedSchoolName`
   * confirmation gate (the new school isn't `new.tsx`'s SUPER_ADMIN's own
   * active tenant, so `useSchoolProfile()` can't resolve it there). */
  schoolName?: string;
  onSchoolNext: (values: SchoolStepValues) => void;
  onAdminSubmit: (values: AdminStepValues) => void;
  /** The footer's primary buttons live in `FullPageShell`, outside the
   * forms, so the route submits through these refs (`requestSubmit`). */
  schoolFormRef?: React.Ref<HTMLFormElement>;
  adminFormRef?: React.Ref<HTMLFormElement>;
  /** Live values on every keystroke — lets the route know the form is dirty
   * before "next" is pressed. */
  onSchoolValuesChange?: (values: SchoolStepValues) => void;
  onAdminValuesChange?: (values: AdminStepValues) => void;
}

export function CreateSchoolWizard({
  step,
  schoolDefaults,
  adminDefaults,
  submitting,
  slugConflict,
  result,
  schoolName,
  onSchoolNext,
  onAdminSubmit,
  schoolFormRef,
  adminFormRef,
  onSchoolValuesChange,
  onAdminValuesChange,
}: CreateSchoolWizardProps) {
  const { t } = useTranslation('platform');

  if (step === 'success' && result) {
    return (
      <div className="space-y-6">
        <StepIndicator current="success" />
        <Card padded>
          <h2 className="text-h2">{t('createWizard.successTitle')}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-text-secondary">
            {t('createWizard.successInvitationLabel')}
            <StatusBadge
              domain="invitation"
              // `ProvisionSchoolResult.invitation.status` is typed `string` (hook-owned); the
              // server sends a derived InvitationStatus.
              status={result.invitation.status as InvitationStatus}
            />
          </p>
          <ImportWorkbookSection
            tenantId={result.school.id}
            expectedSchoolName={schoolName ?? ''}
          />
        </Card>
      </div>
    );
  }

  if (step === 'admin') {
    return (
      <AdminStepForm
        defaults={adminDefaults}
        submitting={submitting}
        formRef={adminFormRef}
        onValuesChange={onAdminValuesChange}
        onSubmit={onAdminSubmit}
      />
    );
  }

  return (
    <SchoolStepForm
      defaults={schoolDefaults}
      {...(slugConflict !== undefined ? { slugConflict } : {})}
      formRef={schoolFormRef}
      onValuesChange={onSchoolValuesChange}
      onNext={onSchoolNext}
    />
  );
}

/** Two-step progress list; `aria-current="step"` marks where the operator is. */
function StepIndicator({ current }: { current: CreateSchoolStep }) {
  const { t } = useTranslation('platform');
  const config = useRegionConfig();
  const steps = [
    { id: 'school', label: t('createWizard.schoolStepTitle') },
    { id: 'admin', label: t('createWizard.adminStepTitle') },
  ] as const;
  const index = current === 'school' ? 0 : current === 'admin' ? 1 : 2;
  return (
    <ol aria-label={t('createWizard.stepsLabel')} className="flex items-center gap-2">
      {steps.map((step, i) => {
        const reached = i <= index;
        return (
          <React.Fragment key={step.id}>
            {i > 0 && <li aria-hidden="true" className="h-px min-w-6 flex-1 bg-border-subtle" />}
            <li
              className="flex min-w-0 items-center gap-2"
              {...(i === index ? { 'aria-current': 'step' as const } : {})}
            >
              <span
                className={
                  reached
                    ? 'flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-label font-semibold text-primary-foreground'
                    : 'flex size-7 shrink-0 items-center justify-center rounded-full border border-border-functional text-label text-text-secondary'
                }
              >
                {formatNumber(i + 1, config)}
              </span>
              <span
                className={
                  i === index
                    ? 'truncate font-semibold text-text-primary'
                    : 'truncate text-text-secondary'
                }
              >
                {step.label}
              </span>
            </li>
          </React.Fragment>
        );
      })}
    </ol>
  );
}

function SchoolStepForm({
  defaults,
  slugConflict,
  formRef,
  onValuesChange,
  onNext,
}: {
  defaults: SchoolStepValues;
  slugConflict?: string;
  formRef?: React.Ref<HTMLFormElement> | undefined;
  onValuesChange?: ((values: SchoolStepValues) => void) | undefined;
  onNext: (values: SchoolStepValues) => void;
}) {
  const { t } = useTranslation('platform');
  const schema = React.useMemo(() => buildSchoolStepSchema((key) => t(key)), [t]);
  const form = useForm<SchoolStepValues>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
  });

  React.useEffect(() => {
    if (!onValuesChange) return;
    const subscription = form.watch((values) =>
      onValuesChange({ name: values.name ?? '', slug: values.slug ?? '' }),
    );
    return () => subscription.unsubscribe();
  }, [form, onValuesChange]);

  // The slug only auto-follows the name until the slug field itself is
  // hand-edited — flips permanently false on the slug input's own
  // onChange below, so a later name edit never clobbers a deliberate
  // slug the admin already typed.
  const slugTouched = React.useRef(
    defaults.slug !== '' && defaults.slug !== slugify(defaults.name),
  );

  // A slug conflict from the server (#409) is a field-level error just
  // like a client-side validation failure.
  React.useEffect(() => {
    if (slugConflict) {
      form.setError('slug', { type: 'server', message: slugConflict });
    }
  }, [slugConflict, form]);

  return (
    <div className="space-y-6">
      <StepIndicator current="school" />
      <Card padded>
        <h2 className="text-h2">{t('createWizard.schoolStepTitle')}</h2>
        <p className="mt-0.5 text-text-secondary">{t('createWizard.schoolStepHelp')}</p>
        <Form {...form}>
          <form
            ref={formRef}
            noValidate
            onSubmit={(event) => void form.handleSubmit(onNext)(event)}
            className="mt-4 grid gap-4"
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="create-school-name" required>
                    {t('createWizard.nameLabel')}
                  </FormLabel>
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
                  <FormLabel htmlFor="create-school-slug" required>
                    {t('createWizard.slugLabel')}
                  </FormLabel>
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
                  <FormDescription>{t('createWizard.slugHelp')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
      </Card>
    </div>
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
          <p className="flex items-center gap-1 text-caption text-destructive">
            <CircleAlertIcon className="size-4 shrink-0" aria-hidden="true" />
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
  formRef,
  onValuesChange,
  onSubmit,
}: {
  defaults: AdminStepValues;
  submitting: boolean;
  formRef?: React.Ref<HTMLFormElement> | undefined;
  onValuesChange?: ((values: AdminStepValues) => void) | undefined;
  onSubmit: (values: AdminStepValues) => void;
}) {
  const { t } = useTranslation('platform');
  const schema = React.useMemo(() => buildAdminStepSchema((key) => t(key)), [t]);
  const form = useForm<AdminStepValues>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
  });

  React.useEffect(() => {
    if (!onValuesChange) return;
    const subscription = form.watch((values) =>
      onValuesChange({
        name: values.name ?? '',
        email: values.email ?? '',
        phone: values.phone ?? '',
      }),
    );
    return () => subscription.unsubscribe();
  }, [form, onValuesChange]);

  return (
    <div className="space-y-6">
      <StepIndicator current="admin" />
      <Card padded>
        <h2 className="text-h2">{t('createWizard.adminStepTitle')}</h2>
        <p className="mt-0.5 text-text-secondary">{t('createWizard.adminStepHelp')}</p>
        <Form {...form}>
          <form
            ref={formRef}
            noValidate
            onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}
            className="mt-4"
          >
            <fieldset disabled={submitting} className="grid gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel htmlFor="create-school-admin-name" required>
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
            </fieldset>
          </form>
        </Form>
      </Card>
    </div>
  );
}
