/**
 * [27.8] `/admission/<slug>/status` — a guardian enters their reference
 * number plus the guardian phone they gave on the form (no login) and sees
 * the applicant's current status. Wired against
 * `POST /public/admission/:slug/status`, whose body carries both fields —
 * see `useAdmissionStatus.ts`'s header comment for why POST, not GET.
 *
 * Same `PUBLIC_PATH_PREFIXES` note as `index.tsx`.
 */
import { AuthLayout, Button, Input, Label, StatusBadge } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, Link } from '@tanstack/react-router';
import { CircleAlertIcon } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { APPLICANT_STATUS } from '../../../features/admission/applicantStatus';
import {
  isUnknownReference,
  useAdmissionStatus,
} from '../../../features/admission/hooks/useAdmissionStatus';
import { loadRouteNamespaces } from '../../../route-loaders';

const statusSearchSchema = z.object({
  // Pre-fills the reference input when arriving from the confirmation
  // screen's "check status" link — a fresh visit with no search param
  // starts blank. The guardian phone isn't in the URL, so it's never
  // pre-filled this way.
  referenceNumber: z.string().optional().catch(undefined),
});

export const Route = createFileRoute('/admission/$slug/status')({
  validateSearch: statusSearchSchema,
  loader: () => loadRouteNamespaces('admission-public'),
  component: AdmissionStatusRoute,
});

function AdmissionStatusRoute() {
  const { t } = useTranslation('admission-public');
  const { slug } = Route.useParams();
  const search = Route.useSearch();
  const [referenceNumber, setReferenceNumber] = React.useState(search.referenceNumber ?? '');
  const [guardianPhone, setGuardianPhone] = React.useState('');

  const [errors, setErrors] = React.useState<{ reference?: string; phone?: string }>({});

  const statusMutation = useAdmissionStatus(slug);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const found = {
      ...(referenceNumber.trim() === '' ? { reference: t('form.errors.required') } : {}),
      ...(guardianPhone.trim() === '' ? { phone: t('form.errors.required') } : {}),
    };
    setErrors(found);
    if (found.reference) {
      document.getElementById('reference-number')?.focus();
      return;
    }
    if (found.phone) {
      document.getElementById('guardian-phone')?.focus();
      return;
    }
    statusMutation.mutate({
      referenceNumber: referenceNumber.trim(),
      guardianPhone: guardianPhone.trim(),
    });
  }

  const requiredMark = (
    <>
      <span className="text-destructive" aria-hidden="true">
        {' *'}
      </span>
      <span className="sr-only">{t('form.required')}</span>
    </>
  );
  const errorLine = (id: string, message: string | undefined) =>
    message ? (
      <p id={`${id}-error`} className="flex items-center gap-1 text-caption text-destructive">
        <CircleAlertIcon className="size-3.5 shrink-0" aria-hidden />
        {message}
      </p>
    ) : null;

  const result = statusMutation.isSuccess ? statusMutation.data : null;
  const known = result !== null && result.status in APPLICANT_STATUS;

  return (
    <AuthLayout>
      <h1 className="text-h1">{t('status.title')}</h1>
      <p className="mt-0.5 text-text-secondary">{t('status.subtitle')}</p>
      <form noValidate onSubmit={handleSubmit} className="mt-5 flex flex-col gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="reference-number">
            {t('status.fields.referenceNumber')}
            {requiredMark}
          </Label>
          <Input
            id="reference-number"
            autoComplete="off"
            value={referenceNumber}
            onChange={(event) => setReferenceNumber(event.target.value)}
            aria-invalid={Boolean(errors.reference)}
            aria-describedby={errors.reference ? 'reference-number-error' : 'reference-number-help'}
          />
          <p id="reference-number-help" className="text-caption text-text-secondary">
            {t('status.fields.referenceNumberHelp')}
          </p>
          {errorLine('reference-number', errors.reference)}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="guardian-phone">
            {t('status.fields.guardianPhone')}
            {requiredMark}
          </Label>
          <Input
            id="guardian-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={guardianPhone}
            onChange={(event) => setGuardianPhone(event.target.value)}
            aria-invalid={Boolean(errors.phone)}
            aria-describedby={errors.phone ? 'guardian-phone-error' : undefined}
          />
          {errorLine('guardian-phone', errors.phone)}
        </div>
        {statusMutation.isError && (
          <p role="alert" className="flex items-center gap-1 text-caption text-destructive">
            <CircleAlertIcon className="size-3.5 shrink-0" aria-hidden />
            {isUnknownReference(statusMutation.error) ? t('status.notFound') : t('status.error')}
          </p>
        )}
        <Button type="submit" className="w-full" loading={statusMutation.isPending}>
          {t('status.submit')}
        </Button>
      </form>

      {result && (
        <div role="status" className="mt-5 border-t border-border-subtle pt-5">
          <StatusBadge
            tone={
              known
                ? APPLICANT_STATUS[result.status as keyof typeof APPLICANT_STATUS].tone
                : 'neutral'
            }
            label={t(known ? `status.badges.${result.status}` : 'status.badges.unknown')}
          />
          <h2 className="mt-2 text-h2">
            {known ? t(`status.statuses.${result.status}`) : t('status.unknown')}
          </h2>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
            <div>
              <dt className="text-caption text-text-secondary">{t('status.studentLabel')}</dt>
              <dd className="font-medium">{result.applicant_name}</dd>
            </div>
            <div>
              <dt className="text-caption text-text-secondary">{t('status.roundLabel')}</dt>
              <dd className="font-medium">{result.intake_title}</dd>
            </div>
          </dl>
          {known && <p className="mt-3 text-text-secondary">{t(`status.next.${result.status}`)}</p>}
        </div>
      )}

      <div className="mt-2 flex justify-center">
        <Link
          to="/admission/$slug"
          params={{ slug }}
          className="inline-flex h-11 items-center rounded-md px-3 font-medium text-primary hover:bg-muted"
        >
          {t('status.newApplication')}
        </Link>
      </div>
    </AuthLayout>
  );
}
