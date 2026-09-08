/**
 * [15.6.8/#551] The platform school-detail page's "SMS credits" card —
 * `POST /schools/:id/sms-credits` (#550) via `useGrantSmsCredits`. There is
 * no platform-facing *read* endpoint for a school's balance (`GET
 * /communications/sms-credits` is `@Roles(ADMIN, ACCOUNTANT)` on the
 * *tenant* controller, unreachable for a SUPER_ADMIN who isn't a member of
 * the school) — so this card shows no balance until the operator's first
 * grant, then the grant response's `{ available, reserved }` becomes the
 * displayed balance for the rest of the session. A page refresh loses it
 * again; that's a known gap, not an oversight — see the issue's own "if no
 * platform read exists" fallback.
 */
import { ApiError } from '@biddaloy/ui/api';
import { Card } from '@biddaloy/ui/components';
import { useGrantSmsCredits, type GrantSmsCreditsInput } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import { GrantSmsCreditsForm, type GrantFormOutput } from './grant-sms-credits-form';

export interface SmsCreditsCardProps {
  schoolId: string;
}

export function SmsCreditsCard({ schoolId }: SmsCreditsCardProps) {
  const { t } = useTranslation('platform');
  const grant = useGrantSmsCredits(schoolId);
  const [balance, setBalance] = React.useState<{ available: number; reserved: number } | null>(
    null,
  );
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
      onSuccess: (result) => {
        idempotencyKeyRef.current = undefined;
        setBalance(result);
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

      {balance === null ? (
        <p className="text-sm text-muted-foreground">{t('schoolDetail.smsCredit.noBalanceYet')}</p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">{t('schoolDetail.smsCredit.available')}</dt>
            <dd className="tabular-nums">{balance.available}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('schoolDetail.smsCredit.reserved')}</dt>
            <dd className="tabular-nums">{balance.reserved}</dd>
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
