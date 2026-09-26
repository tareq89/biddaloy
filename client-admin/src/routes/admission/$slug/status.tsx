/**
 * [27.8] `/admission/<slug>/status` — a guardian enters their reference
 * number plus the guardian phone they gave on the form (no login) and sees
 * the applicant's current status. Wired against
 * `POST /public/admission/:slug/status`, whose body carries both fields —
 * see `useAdmissionStatus.ts`'s header comment for why POST, not GET.
 *
 * Same `PUBLIC_PATH_PREFIXES` note as `index.tsx`.
 */
import { Button, Card, Input, Label } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';
import * as React from 'react';
import { z } from 'zod';

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

  const statusMutation = useAdmissionStatus(slug);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    statusMutation.mutate({
      referenceNumber: referenceNumber.trim(),
      guardianPhone: guardianPhone.trim(),
    });
  }

  return (
    <div className="flex min-h-screen justify-center bg-muted/20 p-4 sm:p-6">
      <div className="w-full max-w-md">
        <Card className="flex flex-col gap-4 p-6">
          <h1 className="text-lg font-semibold">{t('status.title')}</h1>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="reference-number">{t('status.fields.referenceNumber')}</Label>
              <Input
                id="reference-number"
                value={referenceNumber}
                onChange={(event) => setReferenceNumber(event.target.value)}
                required
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="guardian-phone">{t('status.fields.guardianPhone')}</Label>
              <Input
                id="guardian-phone"
                type="tel"
                value={guardianPhone}
                onChange={(event) => setGuardianPhone(event.target.value)}
                required
              />
            </div>
            <Button type="submit" loading={statusMutation.isPending}>
              {t('status.submit')}
            </Button>
          </form>

          {statusMutation.isError && (
            <p role="alert" className="text-sm text-destructive">
              {isUnknownReference(statusMutation.error) ? t('status.notFound') : t('status.error')}
            </p>
          )}

          {statusMutation.isSuccess && (
            <div role="status" className="flex flex-col gap-1 rounded-md border border-border p-4">
              <p className="text-sm text-muted-foreground">{statusMutation.data.intake_title}</p>
              <p className="font-medium">{statusMutation.data.applicant_name}</p>
              <p className="text-lg font-semibold">
                {t(`status.statuses.${statusMutation.data.status}`, {
                  defaultValue: statusMutation.data.status,
                })}
              </p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
