/**
 * [15.6.8/#551] The platform school-detail page's "SMS credits" card —
 * `POST /schools/:id/sms-credits` (#550) via `useGrantSmsCredits`, plus
 * (#570) `GET /schools/:id/sms-credits` via `useSmsCredits(..., schoolId)`
 * to show the balance the school already has on mount, not just after the
 * operator's next grant. The grant mutation still invalidates the
 * `sms-credits` query key broadly, so a successful grant refreshes this
 * card's balance the same way it refreshes `SmsCreditSection`.
 */
import {
  Button,
  Card,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Skeleton,
  toast,
} from '@biddaloy/ui/components';
import { useGrantSmsCredits, useSmsCredits, type GrantSmsCreditsInput } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { CoinsIcon } from 'lucide-react';
import * as React from 'react';

import { GrantSmsCreditsForm, type GrantFormOutput } from './grant-sms-credits-form';

export interface SmsCreditsCardProps {
  schoolId: string;
}

const GRANT_FORM_ID = 'grant-sms-credits-form';

export function SmsCreditsCard({ schoolId }: SmsCreditsCardProps) {
  const { t } = useTranslation('platform');
  const config = useRegionConfig();
  const creditsQuery = useSmsCredits(1, 1, schoolId);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const balance =
    creditsQuery.data && creditsQuery.data.metering === 'PLATFORM'
      ? { available: creditsQuery.data.available, reserved: creditsQuery.data.reserved }
      : null;

  return (
    <Card padded>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-h2">{t('schoolDetail.smsCredit.title')}</h2>
          <p className="mt-1 text-text-secondary">{t('schoolDetail.smsCredit.help')}</p>
        </div>
        {balance !== null && (
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full md:w-auto"
            onClick={() => setDialogOpen(true)}
          >
            <CoinsIcon aria-hidden="true" />
            {t('schoolDetail.smsCredit.grantAction')}
          </Button>
        )}
      </div>

      {creditsQuery.isLoading ? (
        <Skeleton className="mt-4 h-12 w-full" />
      ) : creditsQuery.isError ? (
        <p role="alert" className="mt-4 text-caption text-destructive">
          {t('schoolDetail.smsCredit.loadError')}
        </p>
      ) : balance === null ? (
        <p className="mt-4 text-text-secondary">{t('schoolDetail.smsCredit.unmetered')}</p>
      ) : (
        <dl className="mt-4 grid grid-cols-2 gap-4">
          <div>
            <dt className="text-caption text-text-secondary">
              {t('schoolDetail.smsCredit.available')}
            </dt>
            <dd className="text-h2 tabular-nums">{formatNumber(balance.available, config)}</dd>
          </div>
          <div>
            <dt className="text-caption text-text-secondary">
              {t('schoolDetail.smsCredit.reserved')}
            </dt>
            <dd className="text-h2 tabular-nums">{formatNumber(balance.reserved, config)}</dd>
          </div>
        </dl>
      )}

      <GrantSmsCreditsDialog schoolId={schoolId} open={dialogOpen} onOpenChange={setDialogOpen} />
    </Card>
  );
}

function GrantSmsCreditsDialog({
  schoolId,
  open,
  onOpenChange,
}: {
  schoolId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('platform');
  const grant = useGrantSmsCredits(schoolId);
  const [failed, setFailed] = React.useState(false);

  // One idempotency key per submit *attempt* — held across a retry of that
  // same attempt (the caller resubmitting after a dropped response without
  // touching the fields), reset the moment either field changes or an
  // attempt actually succeeds.
  const idempotencyKeyRef = React.useRef<string | undefined>(undefined);

  function handleFieldsChange() {
    idempotencyKeyRef.current = undefined;
  }

  function handleSubmit(values: GrantFormOutput) {
    setFailed(false);
    idempotencyKeyRef.current ??= crypto.randomUUID();
    const input: GrantSmsCreditsInput = {
      units: values.units,
      reason: values.reason,
      idempotency_key: idempotencyKeyRef.current,
    };
    grant.mutate(input, {
      onSuccess: () => {
        idempotencyKeyRef.current = undefined;
        onOpenChange(false);
        toast.success(t('schoolDetail.smsCredit.grantSuccess'));
      },
      // Translated sentence, never the server's message (D9).
      onError: () => setFailed(true),
    });
  }

  return (
    <Dialog
      open={open}
      // A pending request must not be dismissed from under itself.
      onOpenChange={(next) => {
        if (!next && grant.isPending) return;
        if (!next) setFailed(false);
        onOpenChange(next);
      }}
    >
      <DialogContent
        size="sm"
        showCloseButton={!grant.isPending}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t('schoolDetail.smsCredit.grantTitle')}</DialogTitle>
          <DialogDescription>{t('schoolDetail.smsCredit.help')}</DialogDescription>
        </DialogHeader>
        <GrantSmsCreditsForm
          formId={GRANT_FORM_ID}
          onFieldsChange={handleFieldsChange}
          onSubmit={handleSubmit}
        />
        {failed && (
          <p role="alert" className="text-caption text-destructive">
            {t('schoolDetail.smsCredit.grantError')}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={grant.isPending}>
              {t('actions.cancel', { ns: 'common' })}
            </Button>
          </DialogClose>
          <Button type="submit" form={GRANT_FORM_ID} loading={grant.isPending}>
            {t('schoolDetail.smsCredit.grantSubmit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
