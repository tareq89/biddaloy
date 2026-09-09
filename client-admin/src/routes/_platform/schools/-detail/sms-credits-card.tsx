/**
 * [15.6.8/#551] The platform school-detail page's "SMS credits" card —
 * `POST /schools/:id/sms-credits` (#550) via `useGrantSmsCredits`, plus
 * (#570) `GET /schools/:id/sms-credits` via `useSmsCredits(..., schoolId)`
 * to show the balance the school already has on mount, not just after the
 * operator's next grant. The grant mutation still invalidates the
 * `sms-credits` query key broadly, so a successful grant refreshes this
 * card's balance the same way it refreshes `SmsCreditSection`.
 */
import { ApiError } from '@biddaloy/ui/api';
import { Card } from '@biddaloy/ui/components';
import { useGrantSmsCredits, useSmsCredits, type GrantSmsCreditsInput } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import * as React from 'react';

import { GrantSmsCreditsForm, type GrantFormOutput } from './grant-sms-credits-form';

export interface SmsCreditsCardProps {
  schoolId: string;
}

export function SmsCreditsCard({ schoolId }: SmsCreditsCardProps) {
  const { t } = useTranslation('platform');
  const config = useRegionConfig();
  const grant = useGrantSmsCredits(schoolId);
  const creditsQuery = useSmsCredits(1, 1, schoolId);
  const balance =
    creditsQuery.data && creditsQuery.data.metering === 'PLATFORM'
      ? { available: creditsQuery.data.available, reserved: creditsQuery.data.reserved }
      : null;
  const [submitError, setSubmitError] = React.useState<string | undefined>(undefined);

  // One idempotency key per submit *attempt* — held across a retry of that
  // same attempt (the caller resubmitting after a dropped response without
  // touching the fields), reset the moment either field changes or an
  // attempt actually succeeds.
  const idempotencyKeyRef = React.useRef<string | undefined>(undefined);

  function handleFieldsChange() {
    idempotencyKeyRef.current = undefined;
  }

  function handleSubmit(values: GrantFormOutput) {
    setSubmitError(undefined);
    idempotencyKeyRef.current ??= crypto.randomUUID();
    const input: GrantSmsCreditsInput = {
      units: values.units,
      reason: values.reason,
      idempotency_key: idempotencyKeyRef.current,
    };
    grant.mutate(input, {
      onSuccess: () => {
        idempotencyKeyRef.current = undefined;
      },
      onError: (mutationError: unknown) => {
        setSubmitError(
          mutationError instanceof ApiError
            ? mutationError.message
            : t('schoolDetail.smsCredit.grantError'),
        );
      },
    });
  }

  return (
    <Card className="flex flex-col gap-4 p-4">
      <h2 className="text-sm font-semibold">{t('schoolDetail.smsCredit.title')}</h2>

      {creditsQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">{t('schoolDetail.smsCredit.loading')}</p>
      ) : creditsQuery.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t('schoolDetail.smsCredit.loadError')}
        </p>
      ) : balance === null ? (
        <p className="text-sm text-muted-foreground">{t('schoolDetail.smsCredit.unmetered')}</p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">{t('schoolDetail.smsCredit.available')}</dt>
            <dd className="tabular-nums">{formatNumber(balance.available, config)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('schoolDetail.smsCredit.reserved')}</dt>
            <dd className="tabular-nums">{formatNumber(balance.reserved, config)}</dd>
          </div>
        </dl>
      )}

      {grant.isSuccess && (
        <p role="status" className="text-sm">
          {t('schoolDetail.smsCredit.grantSuccess')}
        </p>
      )}

      <GrantSmsCreditsForm
        submitting={grant.isPending}
        {...(submitError !== undefined ? { submitError } : {})}
        onFieldsChange={handleFieldsChange}
        onSubmit={handleSubmit}
      />
    </Card>
  );
}
