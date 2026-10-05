import { ApiError } from '@biddaloy/ui/api';
import { ConfirmDialog, toast } from '@biddaloy/ui/components';
import { useProvisionSchool, type ProvisionSchoolResult } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { FullPageShell, useCloseFullPage } from '@biddaloy/ui/shells';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import * as React from 'react';

import { loadRouteNamespaces } from '../../../route-loaders';

import {
  CreateSchoolWizard,
  type AdminStepValues,
  type SchoolStepValues,
  type CreateSchoolStep,
} from './-create-school-wizard';

/**
 * #534's two-step create-school wizard: school (name, slug auto-suggested
 * from name, editable) -> first admin (name, email or phone) ->
 * `POST /schools` (#529's `ProvisionSchoolDto`) -> a success step linking
 * to `/schools/$schoolId`.
 *
 * [31.4.platform-1] Full-page modal (D22/D23) on its own chromeless route:
 * the footer buttons live in `FullPageShell`, so each step's form is
 * submitted through a ref (`requestSubmit`).
 *
 * `-create-school-wizard.tsx` carries the actual form markup/steps so it
 * can be storied on its own. This file only wires the live mutation, the
 * idempotency key and the footer.
 */
export const Route = createFileRoute('/_platform/schools/new')({
  staticData: { chromeless: true },
  loader: () => loadRouteNamespaces('platform', 'backup', 'bulkImport'),
  component: CreateSchoolPage,
});

function CreateSchoolPage() {
  const { t } = useTranslation('platform');
  const { t: tCommon } = useTranslation('common');
  const navigate = useNavigate();
  const provisionSchool = useProvisionSchool();
  const close = useCloseFullPage(() => void navigate({ to: '/schools' }));
  const schoolFormRef = React.useRef<HTMLFormElement>(null);
  const adminFormRef = React.useRef<HTMLFormElement>(null);

  // Generated once per wizard instance (mount), not per submit attempt —
  // the whole point of `idempotency_key` (#529's Redis `SET ... NX EX`
  // no-op replay) is that a retried submit after a failed/timed-out first
  // attempt reuses the SAME key, so the server treats it as "did I already
  // do this?" instead of creating a second school. Regenerating per
  // attempt would defeat that.
  const [idempotencyKey] = React.useState(() => crypto.randomUUID());

  const [step, setStep] = React.useState<CreateSchoolStep>('school');
  const [schoolValues, setSchoolValues] = React.useState<SchoolStepValues>({
    name: '',
    slug: '',
  });
  const [adminValues, setAdminValues] = React.useState<AdminStepValues>({
    name: '',
    email: '',
    phone: '',
  });
  // Live (per-keystroke) copies, so the page is "dirty" before "next".
  const [liveSchool, setLiveSchool] = React.useState<SchoolStepValues>(schoolValues);
  const [liveAdmin, setLiveAdmin] = React.useState<AdminStepValues>(adminValues);
  const [slugConflict, setSlugConflict] = React.useState<string | undefined>(undefined);
  const [result, setResult] = React.useState<ProvisionSchoolResult | undefined>(undefined);
  const [discarding, setDiscarding] = React.useState(false);

  const dirty =
    step !== 'success' &&
    (liveSchool.name !== '' ||
      liveSchool.slug !== '' ||
      liveAdmin.name !== '' ||
      (liveAdmin.email ?? '') !== '' ||
      (liveAdmin.phone ?? '') !== '');
  const pending = provisionSchool.isPending;

  // Nothing leaves mid-request: a second submit would race the first.
  const guardedClose = () => {
    if (!pending) close();
  };
  // Footer "Cancel" bypasses `FullPageShell`'s own discard prompt.
  const cancel = () => {
    if (dirty) setDiscarding(true);
    else guardedClose();
  };

  function handleSchoolNext(values: SchoolStepValues) {
    setSchoolValues(values);
    setSlugConflict(undefined);
    setStep('admin');
  }

  function handleAdminBack() {
    if (pending) return;
    setAdminValues(liveAdmin);
    setStep('school');
  }

  function handleAdminSubmit(values: AdminStepValues) {
    setAdminValues(values);
    setSlugConflict(undefined);
    provisionSchool.mutate(
      {
        name: schoolValues.name,
        slug: schoolValues.slug,
        admin: {
          name: values.name,
          ...(values.email ? { email: values.email } : {}),
          ...(values.phone ? { phone: values.phone } : {}),
        },
        idempotency_key: idempotencyKey,
      },
      {
        onSuccess: (data) => {
          setResult(data);
          setStep('success');
        },
        onError: (error) => {
          if (error instanceof ApiError && error.statusCode === 409) {
            setSlugConflict(t('createWizard.slugConflict'));
            setStep('school');
            return;
          }
          toast.error(t('createWizard.submitError'));
        },
      },
    );
  }

  const footer =
    step === 'school'
      ? {
          secondary: { label: tCommon('actions.cancel'), onClick: cancel },
          primary: {
            label: t('createWizard.nextAction'),
            onClick: () => schoolFormRef.current?.requestSubmit(),
          },
        }
      : step === 'admin'
        ? {
            secondary: { label: t('createWizard.backAction'), onClick: handleAdminBack },
            primary: {
              label: t('createWizard.submitAction'),
              onClick: () => adminFormRef.current?.requestSubmit(),
              busy: pending,
            },
          }
        : {
            primary: {
              label: t('createWizard.viewSchool'),
              onClick: () =>
                void navigate({
                  to: '/schools/$schoolId',
                  params: { schoolId: result?.school.id ?? '' },
                }),
            },
          };

  return (
    <FullPageShell
      title={t('createWizard.title')}
      onClose={guardedClose}
      dirty={dirty}
      size="form"
      {...footer}
    >
      <CreateSchoolWizard
        step={step}
        schoolDefaults={schoolValues}
        adminDefaults={adminValues}
        submitting={pending}
        {...(slugConflict !== undefined ? { slugConflict } : {})}
        {...(result !== undefined ? { result } : {})}
        schoolName={schoolValues.name}
        onSchoolNext={handleSchoolNext}
        onAdminSubmit={handleAdminSubmit}
        schoolFormRef={schoolFormRef}
        adminFormRef={adminFormRef}
        onSchoolValuesChange={setLiveSchool}
        onAdminValuesChange={setLiveAdmin}
      />
      <ConfirmDialog
        open={discarding}
        onOpenChange={setDiscarding}
        tone="danger"
        title={tCommon('fullPage.discardTitle')}
        description={tCommon('fullPage.discardDescription')}
        confirmLabel={tCommon('fullPage.discardConfirm')}
        cancelLabel={tCommon('fullPage.keepEditing')}
        onConfirm={() => {
          setDiscarding(false);
          guardedClose();
        }}
      />
    </FullPageShell>
  );
}
