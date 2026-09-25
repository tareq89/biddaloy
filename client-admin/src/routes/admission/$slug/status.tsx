/**
 * [27.8] `/admission/<slug>/status` — a guardian enters their reference
 * number (no login) and sees the applicant's current status. Wired against
 * `GET /public/admission/:slug/status/:referenceNumber`, which sibling
 * ticket #1042 adds in parallel on this same branch — see
 * `useAdmissionStatus.ts`'s header comment. `enabled` there means an empty
 * input never fires a request, so this renders fine whether or not that
 * route exists yet.
 *
 * Same `PUBLIC_PATH_PREFIXES` note as `index.tsx`.
 */
import { Button, Card, Input, Label } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';
import * as React from 'react';
import { z } from 'zod';

import { isUnknownReference, useAdmissionStatus } from '../../../features/admission/hooks/useAdmissionStatus';
import { loadRouteNamespaces } from '../../../route-loaders';

const statusSearchSchema = z.object({
  // Pre-fills the input when arriving from the confirmation screen's
  // "check status" link — a fresh visit with no search param starts blank.
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
  const [submittedReference, setSubmittedReference] = React.useState(search.referenceNumber ?? '');

  const statusQuery = useAdmissionStatus(slug, submittedReference);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = referenceNumber.trim();
    if (trimmed === submittedReference) {
      // Same reference re-submitted (e.g. retrying after a not-found) —
      // the query key won't change, so refetch explicitly instead of
      // relying on React Query to notice a no-op setState.
      void statusQuery.refetch();
    } else {
      setSubmittedReference(trimmed);
    }
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
            <Button type="submit">{t('status.submit')}</Button>
          </form>

          {statusQuery.isPending && submittedReference && (
            <p role="status" className="text-sm text-muted-foreground">
              {t('status.loading')}
            </p>
          )}

          {statusQuery.isError && (
            <p role="alert" className="text-sm text-destructive">
              {isUnknownReference(statusQuery.error) ? t('status.notFound') : t('status.error')}
            </p>
          )}

          {statusQuery.isSuccess && (
            <div role="status" className="flex flex-col gap-1 rounded-md border border-border p-4">
              <p className="text-sm text-muted-foreground">{statusQuery.data.intake_title}</p>
              <p className="font-medium">{statusQuery.data.applicant_name}</p>
              <p className="text-lg font-semibold">
                {t(`status.statuses.${statusQuery.data.status}`, {
                  defaultValue: statusQuery.data.status,
                })}
              </p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
