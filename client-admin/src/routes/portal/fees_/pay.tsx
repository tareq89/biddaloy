/**
 * [3.4.01] Guardian "Pay fees" page, proof path: pick bills (all pre-ticked), say how they paid,
 * give the TrxID and/or photos. Money is summed in whole paisa; the amount is read-only (D26).
 * [3.x/#3990] The bKash choice sends the guardian to bKash; the result page is `pay/result`.
 */
import type { PaymentMethod } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  Checkbox,
  ChoiceCards,
  FileUpload,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatusBadge,
  type FileUploadItem,
} from '@biddaloy/ui/components';
import {
  usePaymentCart,
  usePaymentOptions,
  useStartOnlinePayment,
  useSubmitPaymentProof,
} from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { FullPageShell, useCloseFullPage } from '@biddaloy/ui/shells';
import {
  formatServerAmount,
  minorUnitsToDecimalString,
  serverAmountToMinorUnits,
  tenantTodayIso,
} from '@biddaloy/ui/utils';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../route-loaders';

/** `?how=proof` opens the proof form (the result page links here after a failed online payment). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `?student=<id>` scopes the page to one child's bills; a bad value falls back to all bills. */
const searchSchema = z.object({
  how: z.literal('proof').optional().catch(undefined),
  student: z
    .string()
    .refine((v) => UUID_RE.test(v))
    .optional()
    .catch(undefined),
});

export const Route = createFileRoute('/portal/fees_/pay')({
  validateSearch: searchSchema,
  loader: () => loadRouteNamespaces('portalPay', 'common'),
  component: PortalPayRoute,
});

const MAX_FILES = 2;
const ACCEPT = 'image/jpeg,image/png,application/pdf';

function PortalPayRoute() {
  const { student } = Route.useSearch();
  return (
    <RegionConfigProvider>
      <PortalPayPage scopeStudentId={student} />
    </RegionConfigProvider>
  );
}

type ErrorKey = 'method' | 'date' | 'future' | 'evidence' | 'tooManyFiles';

export function PortalPayPage({ scopeStudentId }: { scopeStudentId?: string | undefined } = {}) {
  const { t } = useTranslation('portalPay');
  const { t: tCommon } = useTranslation('common');
  const config = useRegionConfig();
  const navigate = useNavigate();
  const close = useCloseFullPage(() => void navigate({ to: '/portal/fees' }));

  const optionsQuery = usePaymentOptions();
  const cartQuery = usePaymentCart();
  const submit = useSubmitPaymentProof();
  const start = useStartOnlinePayment();

  // Pre-ticked: every open bill that is not already waiting. The guardian only un-ticks.
  // Explicit ticks only; a bill with no entry follows the scope (see `isOn`).
  const [picked, setPicked] = React.useState<ReadonlyMap<string, boolean>>(new Map());
  const [method, setMethod] = React.useState<string | undefined>(undefined);
  const [paidOn, setPaidOn] = React.useState('');
  const [trxId, setTrxId] = React.useState('');
  const [files, setFiles] = React.useState<FileUploadItem[]>([]);
  const [errors, setErrors] = React.useState<Partial<Record<ErrorKey | 'bills', true>>>({});
  const [submitError, setSubmitError] = React.useState<'storageDown' | 'busy' | 'generic'>();
  const [done, setDone] = React.useState(false);
  const [how, setHow] = React.useState<'bkash' | 'proof' | undefined>(Route.useSearch().how);
  const [bkashError, setBkashError] = React.useState<'down' | 'generic'>();

  const students = cartQuery.data?.students ?? [];
  const scopeValid = students.some((s) => s.studentId === scopeStudentId);
  const isOn = (bill: { id: string; waitingSubmission: unknown }, studentId: string) =>
    bill.waitingSubmission === null &&
    (picked.get(bill.id) ?? (!scopeValid || studentId === scopeStudentId));
  const selected = students.flatMap((s) => s.bills.filter((b) => isOn(b, s.studentId)));
  const totalPaisa = selected.reduce(
    (sum, b) => sum + serverAmountToMinorUnits(b.balance, config),
    0,
  );
  const totalText = minorUnitsToDecimalString(totalPaisa, config);

  const options = optionsQuery.data;
  const methods = options?.proofMethods ?? [];
  const chosen =
    methods.find((m) => m.method === method) ?? (methods.length === 1 ? methods[0] : undefined);
  const today = tenantTodayIso(config, new Date());
  const onlineOn = options?.onlineEnabled === true;
  const proofOn = options?.proofEnabled === true && methods.length > 0;
  const mode = how ?? (onlineOn ? 'bkash' : 'proof');

  function onPayBkash() {
    setBkashError(undefined);
    setErrors(selected.length === 0 ? { bills: true } : {});
    if (selected.length === 0) return;
    start.mutate(
      selected.map((b) => b.id),
      {
        onSuccess: (res) => {
          // Only ever send the guardian to a secure page; anything else is treated as a failure.
          if (!res.bkashUrl.startsWith('https://')) return setBkashError('generic');
          window.location.assign(res.bkashUrl);
        },
        onError: (error) => {
          // D19: Redis/bKash down answers 503 with a fixed sentence; offer proof instead.
          setBkashError(error instanceof ApiError && error.statusCode === 503 ? 'down' : 'generic');
        },
      },
    );
  }

  function toggle(id: string, on: boolean) {
    setPicked((prev) => new Map(prev).set(id, on));
  }

  function onSubmit() {
    const next: Partial<Record<ErrorKey | 'bills', true>> = {};
    if (selected.length === 0) next.bills = true;
    if (!chosen) next.method = true;
    if (paidOn === '') next.date = true;
    else if (paidOn > today) next.future = true;
    if (trxId.trim() === '' && files.length === 0) next.evidence = true;
    if (files.length > MAX_FILES) next.tooManyFiles = true;
    setErrors(next);
    setSubmitError(undefined);
    if (Object.keys(next).length > 0 || !chosen) return;
    submit.mutate(
      {
        billIds: selected.map((b) => b.id),
        method: chosen.method as PaymentMethod,
        amount: Number(totalText),
        paidOn,
        ...(trxId.trim() !== '' ? { reference: trxId.trim() } : {}),
        files: files.map((f) => f.file),
      },
      {
        onSuccess: () => setDone(true),
        onError: (error) => {
          const status = error instanceof ApiError ? error.statusCode : 0;
          setSubmitError(status === 503 ? 'storageDown' : status === 409 ? 'busy' : 'generic');
          if (status === 409) void cartQuery.refetch(); // busy bill returns as waiting and drops out
        },
      },
    );
  }

  if (done) {
    return (
      <FullPageShell title={t('page.title')} onClose={close} closeLabel={t('page.close')}>
        <section className="space-y-3">
          <h2 className="text-h2">{t('done.title')}</h2>
          <p className="text-text-secondary">{t('done.body')}</p>
          <Button asChild>
            <Link to="/portal/fees">{t('page.back')}</Link>
          </Button>
        </section>
      </FullPageShell>
    );
  }

  const loading = optionsQuery.isPending || cartQuery.isPending;
  const failed = optionsQuery.isError || cartQuery.isError;
  const hasBills = students.some((s) => s.bills.length > 0);

  return (
    <FullPageShell
      title={t('page.title')}
      onClose={close}
      closeLabel={t('page.close')}
      dirty={files.length > 0 || trxId !== '' || paidOn !== ''}
      {...((onlineOn || proofOn) && hasBills
        ? {
            primary:
              mode === 'bkash'
                ? {
                    label: t('bkash.pay', { amount: formatServerAmount(totalText, config) }),
                    onClick: onPayBkash,
                    busy: start.isPending,
                  }
                : { label: t('proof.submit'), onClick: onSubmit, busy: submit.isPending },
          }
        : {})}
    >
      {loading ? (
        <p role="status">{t('page.loading')}</p>
      ) : failed ? (
        <div className="space-y-3">
          <p role="alert">{t('page.loadError')}</p>
          <Button
            variant="outline"
            onClick={() => {
              void optionsQuery.refetch();
              void cartQuery.refetch();
            }}
          >
            {t('page.retry')}
          </Button>
        </div>
      ) : !onlineOn && !proofOn ? (
        <p>{t('page.officeOnly')}</p>
      ) : !hasBills ? (
        <p>{t('page.nothingToPay')}</p>
      ) : (
        <div className="space-y-6">
          <section className="rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5">
            <h2 className="text-h2">{t('bills.title')}</h2>
            <p className="mt-0.5 text-text-secondary">{t('bills.hint')}</p>
            <div className="mt-3 space-y-3">
              {students.map((student) => (
                <fieldset key={student.studentId} className="divide-y divide-border-subtle">
                  <legend className="text-label text-text-secondary">{student.fullName}</legend>
                  {student.bills.map((bill) => {
                    const waiting = bill.waitingSubmission !== null;
                    const id = `bill-${bill.id}`;
                    return (
                      <div key={bill.id} className="flex min-h-11 items-center gap-3 px-1">
                        <Checkbox
                          id={id}
                          checked={isOn(bill, student.studentId)}
                          disabled={waiting}
                          onCheckedChange={(on) => toggle(bill.id, on === true)}
                        />
                        <label
                          htmlFor={id}
                          className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3"
                        >
                          <span className="font-medium">
                            {bill.name}
                            {waiting && (
                              <span className="ml-2">
                                <StatusBadge tone="warning" label={t('bills.waiting')} />
                              </span>
                            )}
                          </span>
                          <span className="font-medium tabular-nums">
                            {formatServerAmount(bill.balance, config)}
                          </span>
                        </label>
                      </div>
                    );
                  })}
                </fieldset>
              ))}
            </div>
            {errors.bills && (
              <p role="alert" className="mt-2 text-status-overdue-fg">
                {t('bills.noneSelected')}
              </p>
            )}
            <p className="mt-3 flex justify-between border-t border-border-subtle pt-3 text-h3">
              <span>{t('bills.total')}</span>
              <span className="tabular-nums">{formatServerAmount(totalText, config)}</span>
            </p>
          </section>

          <section className="rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5">
            <h2 id="pay-how" className="text-h2">
              {t('how.title')}
            </h2>
            <div className="mt-3">
              <ChoiceCards
                labelledBy="pay-how"
                value={mode}
                onValueChange={(v) => {
                  setHow(v === 'bkash' ? 'bkash' : 'proof');
                  setErrors({});
                }}
                columns={2}
                options={[
                  ...(onlineOn
                    ? [
                        {
                          value: 'bkash',
                          title: t('how.bkashTitle'),
                          description: t('how.bkashNote'),
                        },
                      ]
                    : []),
                  ...(proofOn
                    ? [
                        {
                          value: 'proof',
                          title: t('how.proofTitle'),
                          description: t('how.proofNote'),
                        },
                      ]
                    : []),
                ]}
              />
            </div>
          </section>

          {mode === 'bkash' && bkashError && (
            <div role="alert" className="space-y-2 text-status-overdue-fg">
              <p>{t(bkashError === 'down' ? 'errors.bkashDown' : 'errors.bkashGeneric')}</p>
              {proofOn && (
                <Button variant="outline" onClick={() => setHow('proof')}>
                  {t('bkash.useProof')}
                </Button>
              )}
            </div>
          )}

          {mode === 'bkash' && (
            <p className="text-text-secondary">
              {t('bkash.exactNote', { amount: formatServerAmount(totalText, config) })}
            </p>
          )}

          {mode === 'proof' && (
            <section className="rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5">
              <h2 className="text-h2">{t('proof.title')}</h2>
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="proof-method" className="text-label text-text-primary">
                    {t('proof.method')}
                  </label>
                  <Select value={chosen?.method ?? ''} onValueChange={setMethod}>
                    <SelectTrigger id="proof-method" aria-invalid={errors.method === true}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {methods.map((m) => (
                        <SelectItem key={m.method} value={m.method}>
                          {tCommon(`enums.paymentMethod.${m.method}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.method && (
                    <p role="alert" className="text-status-overdue-fg">
                      {t('errors.method')}
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="proof-amount" className="text-label text-text-primary">
                    {t('proof.amount')}
                  </label>
                  <Input id="proof-amount" readOnly value={formatServerAmount(totalText, config)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="proof-trx" className="text-label text-text-primary">
                    {t('proof.trxId')}
                  </label>
                  <Input
                    id="proof-trx"
                    value={trxId}
                    maxLength={64}
                    placeholder={t('proof.trxIdPlaceholder')}
                    onChange={(e) => setTrxId(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="proof-date" className="text-label text-text-primary">
                    {t('proof.paidOn')}
                  </label>
                  <Input
                    id="proof-date"
                    type="date"
                    max={today}
                    value={paidOn}
                    aria-invalid={errors.date === true || errors.future === true}
                    onChange={(e) => setPaidOn(e.target.value)}
                  />
                  {(errors.date || errors.future) && (
                    <p role="alert" className="text-status-overdue-fg">
                      {errors.future ? t('errors.future') : t('errors.date')}
                    </p>
                  )}
                </div>
              </div>
              {chosen && chosen.instructions !== '' && (
                <p className="mt-2 text-text-secondary">
                  {t('proof.instructions', { text: chosen.instructions })}
                </p>
              )}
              <div className="mt-4">
                <p className="text-label text-text-primary">{t('proof.files')}</p>
                <div className="mt-2">
                  <FileUpload
                    aria-label={t('proof.filesLabel')}
                    items={files}
                    accept={ACCEPT}
                    disabled={submit.isPending}
                    onFilesSelected={(picked) =>
                      setFiles((prev) => [
                        ...prev,
                        ...picked.map((file) => ({ id: crypto.randomUUID(), file })),
                      ])
                    }
                    onRemove={(file) => setFiles((prev) => prev.filter((f) => f.file !== file))}
                  />
                </div>
                {errors.tooManyFiles && (
                  <p role="alert" className="mt-2 text-status-overdue-fg">
                    {t('errors.tooManyFiles')}
                  </p>
                )}
              </div>
              <p
                className={
                  errors.evidence ? 'mt-3 text-status-overdue-fg' : 'mt-3 text-text-secondary'
                }
                role={errors.evidence ? 'alert' : undefined}
              >
                {errors.evidence ? t('errors.evidence') : t('proof.evidenceHint')}
              </p>
              {submitError && (
                <p role="alert" className="mt-3 text-status-overdue-fg">
                  {t(`errors.${submitError}`)}
                </p>
              )}
            </section>
          )}
        </div>
      )}
    </FullPageShell>
  );
}
