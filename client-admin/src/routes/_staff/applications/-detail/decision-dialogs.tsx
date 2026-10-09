/**
 * [52.5.2] Approve / reject / consider / cancel dialogs and the withdraw confirm for one open
 * application. Errors show inside the dialog as a translated sentence chosen by
 * `error.details.code`; the server's own text is never shown.
 */
import { APPLICATION_OVERRIDE_ROLES, ApplicationType } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Form,
  Input,
  Label,
} from '@biddaloy/ui/components';
import {
  ApprovalCancelledError,
  applicationKeys,
  useActiveRole,
  useApproveApplication,
  useCancelApplication,
  useConsiderApplication,
  useRejectApplication,
  useWithdrawApplication,
  type ApplicationDto,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { CircleAlertIcon } from 'lucide-react';
import * as React from 'react';
import { useForm, type FieldValues } from 'react-hook-form';

import { APPLICATION_FORMS } from '../../../../features/applications/forms/registry';

export type DecisionKind = 'approve' | 'reject' | 'consider' | 'cancel' | 'withdraw';

const KNOWN_CODES = new Set([
  'NOT_A_DECIDER',
  'EFFECT_PERMISSION_REQUIRED',
  'APPLICATION_NOT_OPEN',
  'APPLICATION_CHANGED',
  'GRANTED_NOT_ALLOWED',
  'INVALID_GRANTED',
  'ALREADY_UNDER_CONSIDERATION',
  'NOT_CANCELLABLE',
  'APPLICANT_CANNOT_CANCEL',
  'APPLICATION_NOT_PENDING',
  'LEAVE_BALANCE_EXCEEDED',
  'LEAVE_NO_WORKING_DAYS',
  'LEAVE_NOT_CANCELLABLE',
  'LEAVE_OVERLAP',
  'LEAVE_POLICY_MISSING',
  'LEAVE_ALREADY_ENDED',
  'DATE_IN_FUTURE',
  'NO_ACTIVE_ENROLLMENT',
  'SECTION_UNCHANGED',
  'NOT_FOUND',
]);

/** The translated sentence for a failed decision; a cancelled step-up shows nothing. */
function useDecisionError(app: Pick<ApplicationDto, 'id'>) {
  const { t } = useTranslation('applicationsDetail');
  const queryClient = useQueryClient();
  const [error, setError] = React.useState<string | undefined>();
  const fail = (e: unknown) => {
    if (e instanceof ApprovalCancelledError) return;
    const code = e instanceof ApiError ? (e.details as { code?: string } | undefined)?.code : '';
    const known = code !== undefined && KNOWN_CODES.has(code);
    setError(t(known ? `errors.${code}` : 'errors.fallback'));
    // Someone else decided first: show what is true now.
    if (code === 'APPLICATION_CHANGED') {
      void queryClient.invalidateQueries({ queryKey: applicationKeys.detail(app.id) });
    }
  };
  return { error, fail, clear: () => setError(undefined) };
}

function ErrorLine({ message }: { message: string | undefined }) {
  if (!message) return null;
  return (
    <p role="alert" className="flex items-center gap-1 text-caption text-destructive">
      <CircleAlertIcon aria-hidden="true" className="size-3.5" />
      {message}
    </p>
  );
}

interface DialogProps {
  app: ApplicationDto;
  onClose: () => void;
  onDone: (kind: DecisionKind) => void;
}

/** Enter submits: the single-line field sits inside this form (D25). */
function ApproveDialog({ app, onClose, onDone }: DialogProps) {
  const { t } = useTranslation('applicationsDetail');
  const { t: tForms } = useTranslation('applicationForms');
  const regionConfig = useRegionConfig();
  const role = useActiveRole();
  const approve = useApproveApplication();
  const { error, fail, clear } = useDecisionError(app);
  const [note, setNote] = React.useState('');
  const noteRef = React.useRef<HTMLInputElement>(null);

  const isOverride = (APPLICATION_OVERRIDE_ROLES as readonly string[]).includes(role ?? '');
  // The final FEE_WAIVER approval writes the discount rule: the approver confirms the amount (D39, D49).
  const grantsAmount =
    app.type === 'FEE_WAIVER' && (isOverride || app.current_step >= app.step_count - 1);

  const def = APPLICATION_FORMS[ApplicationType.FEE_WAIVER];
  const schema = React.useMemo(() => def.schema(tForms, regionConfig), [def, tForms, regionConfig]);
  const p = app.payload;
  const form = useForm<FieldValues>({
    resolver: zodResolver(schema),
    // `reason` is the applicant's own, kept so the shared schema passes; it is hidden and not sent.
    defaultValues: {
      kind: p.kind,
      value: typeof p.value === 'number' ? String(p.value) : '',
      fee_types: p.fee_types ?? [],
      start_date: p.start_date ?? '',
      end_date: p.end_date ?? '',
      reason: p.reason ?? '',
    },
  });

  const submit = (granted?: Record<string, unknown>) => {
    clear();
    approve.mutate(
      {
        id: app.id,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(granted ? { granted: granted as never } : {}),
      },
      { onSuccess: () => onDone('approve'), onError: fail },
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        size={grantsAmount ? 'md' : 'sm'}
        closeLabel={t('dialogs.close')}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          noteRef.current?.focus();
        }}
        onEscapeKeyDown={(e) => approve.isPending && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t('dialogs.approve.title')}</DialogTitle>
          <DialogDescription>
            {t(grantsAmount ? 'dialogs.approve.grantedHint' : 'dialogs.approve.description')}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            id="approve-application-form"
            noValidate
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!grantsAmount) return submit();
              void form.handleSubmit((values) => {
                const granted = { ...values };
                delete granted.reason;
                submit(granted);
              })(event);
            }}
          >
            {grantsAmount && (
              // The shared fields end with the applicant's `reason` box: not for the approver to edit.
              <div className="grid gap-4 md:grid-cols-2 [&>:last-child]:hidden">
                <def.Fields subject={{ kind: 'STAFF', staffProfileId: '' }} />
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="approve-note">{t('dialogs.noteLabel')}</Label>
              <Input
                id="approve-note"
                ref={noteRef}
                value={note}
                maxLength={500}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <ErrorLine message={error} />
          </form>
        </Form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={approve.isPending}>
            {t('dialogs.close')}
          </Button>
          <Button type="submit" form="approve-application-form" loading={approve.isPending}>
            {t('dialogs.approve.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Reject and cancel both need a written reason (≤ 500). */
function ReasonDialog({ kind, app, onClose, onDone }: DialogProps & { kind: 'reject' | 'cancel' }) {
  const { t } = useTranslation('applicationsDetail');
  const reject = useRejectApplication();
  const cancel = useCancelApplication();
  const mutation = kind === 'reject' ? reject : cancel;
  const { error, fail, clear } = useDecisionError(app);
  const [reason, setReason] = React.useState('');
  const [invalid, setInvalid] = React.useState<string | undefined>();
  const reasonRef = React.useRef<HTMLInputElement>(null);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const text = reason.trim();
    if (!text) return setInvalid(t(`dialogs.${kind}.reasonRequired`));
    if (text.length > 500) return setInvalid(t(`dialogs.${kind}.reasonTooLong`));
    setInvalid(undefined);
    clear();
    mutation.mutate({ id: app.id, reason: text }, { onSuccess: () => onDone(kind), onError: fail });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        size="sm"
        closeLabel={t('dialogs.close')}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          reasonRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t(`dialogs.${kind}.title`)}</DialogTitle>
          <DialogDescription>
            {t(kind === 'cancel' ? 'dialogs.cancel.description' : 'dialogs.reject.description')}
          </DialogDescription>
        </DialogHeader>
        <form id={`${kind}-application-form`} noValidate className="space-y-4" onSubmit={submit}>
          <div className="space-y-1">
            <Label htmlFor={`${kind}-reason`}>{t(`dialogs.${kind}.reasonLabel`)}</Label>
            <Input
              id={`${kind}-reason`}
              ref={reasonRef}
              value={reason}
              aria-invalid={invalid ? true : undefined}
              onChange={(e) => setReason(e.target.value)}
            />
            <ErrorLine message={invalid} />
          </div>
          <ErrorLine message={error} />
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={mutation.isPending}>
            {t('dialogs.close')}
          </Button>
          <Button
            type="submit"
            form={`${kind}-application-form`}
            variant="destructive"
            loading={mutation.isPending}
          >
            {t(`dialogs.${kind}.submit`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConsiderDialog({ app, onClose, onDone }: DialogProps) {
  const { t } = useTranslation('applicationsDetail');
  const consider = useConsiderApplication();
  const { error, fail, clear } = useDecisionError(app);
  const [note, setNote] = React.useState('');
  const noteRef = React.useRef<HTMLInputElement>(null);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        size="sm"
        closeLabel={t('dialogs.close')}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          noteRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('dialogs.consider.title')}</DialogTitle>
          <DialogDescription>{t('dialogs.consider.description')}</DialogDescription>
        </DialogHeader>
        <form
          id="consider-application-form"
          noValidate
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            clear();
            consider.mutate(
              { id: app.id, ...(note.trim() ? { note: note.trim() } : {}) },
              { onSuccess: () => onDone('consider'), onError: fail },
            );
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="consider-note">{t('dialogs.noteLabel')}</Label>
            <Input
              id="consider-note"
              ref={noteRef}
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <ErrorLine message={error} />
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={consider.isPending}>
            {t('dialogs.close')}
          </Button>
          <Button type="submit" form="consider-application-form" loading={consider.isPending}>
            {t('dialogs.consider.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WithdrawDialog({ app, onClose, onDone }: DialogProps) {
  const { t } = useTranslation('applicationsDetail');
  const withdraw = useWithdrawApplication();
  const { error, fail, clear } = useDecisionError(app);

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('dialogs.withdraw.title')}
      description={error ?? t('dialogs.withdraw.description')}
      confirmLabel={t('dialogs.withdraw.confirm')}
      cancelLabel={t('dialogs.withdraw.keep')}
      busy={withdraw.isPending}
      onConfirm={() => {
        clear();
        withdraw.mutate(app.id, { onSuccess: () => onDone('withdraw'), onError: fail });
      }}
    />
  );
}

export function DecisionDialogs({ kind, ...props }: DialogProps & { kind: DecisionKind | null }) {
  if (kind === 'approve') return <ApproveDialog {...props} />;
  if (kind === 'reject' || kind === 'cancel') return <ReasonDialog kind={kind} {...props} />;
  if (kind === 'consider') return <ConsiderDialog {...props} />;
  if (kind === 'withdraw') return <WithdrawDialog {...props} />;
  return null;
}
