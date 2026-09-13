import { ApiError } from '@biddaloy/ui/api';
import { toast } from '@biddaloy/ui/components';
import { useProvisionSchool, type ProvisionSchoolResult } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, Link } from '@tanstack/react-router';
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
 * `POST /schools` (#529's `ProvisionSchoolDto`) -> a success screen
 * linking to `/schools/$schoolId` (#535's placeholder today).
 *
 * `-create-school-wizard.tsx` carries the actual form markup/steps so it
 * can be storied on its own — same split #533's list page established
 * for `-schools-list-view.tsx`. This file only wires the live mutation,
 * the idempotency key, and the router link.
 */
export const Route = createFileRoute('/_platform/schools/new')({
  loader: () => loadRouteNamespaces('platform', 'backup', 'bulkImport'),
  component: CreateSchoolPage,
});

function CreateSchoolPage() {
  const { t } = useTranslation('platform');
  const provisionSchool = useProvisionSchool();

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
  const [slugConflict, setSlugConflict] = React.useState<string | undefined>(undefined);
  const [result, setResult] = React.useState<ProvisionSchoolResult | undefined>(undefined);

  function handleSchoolNext(values: SchoolStepValues) {
    setSchoolValues(values);
    setStep('admin');
  }

  function handleAdminBack() {
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
          toast.error(error instanceof Error ? error.message : String(error));
        },
      },
    );
  }

  return (
    <CreateSchoolWizard
      step={step}
      schoolDefaults={schoolValues}
      adminDefaults={adminValues}
      submitting={provisionSchool.isPending}
      {...(slugConflict !== undefined ? { slugConflict } : {})}
      {...(result !== undefined ? { result } : {})}
      schoolName={schoolValues.name}
      onSchoolNext={handleSchoolNext}
      onAdminBack={handleAdminBack}
      onAdminSubmit={handleAdminSubmit}
      renderDetailLink={(schoolId) => (
        <Link
          to="/schools/$schoolId"
          params={{ schoolId }}
          className="font-medium text-primary underline"
        >
          {t('createWizard.viewSchool')}
        </Link>
      )}
    />
  );
}
