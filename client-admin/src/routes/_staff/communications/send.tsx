import { Permission } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatusBadge,
  Textarea,
} from '@biddaloy/ui/components';
import {
  useCommunicationLog,
  useHasPermission,
  useSendCommunication,
  type Guardian,
  type SendCommunicationInput,
  type Student,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import * as React from 'react';

import { SmsSegmentCounter } from './-shared/sms-segment-counter';
import { StudentSearch } from './-shared/student-search';
import { splitTemplateParams, WhatsappTemplateFields } from './-shared/whatsapp-template-fields';

/**
 * `/communications/send` — [8.11.9]'s Send Message page: one
 * staff-composed message to one recipient via `POST /communications/send`.
 *
 * The worker only has providers for SMS / WHATSAPP / EMAIL — a
 * PHONE_CALL or MESSENGER send would be accepted and then marked FAILED
 * (`No provider registered for medium …`), so the channel `Select` offers
 * exactly the three deliverable ones.
 *
 * This endpoint has no server preview (unlike the reminder routes), so
 * the shared "nothing sends until the sender has seen exactly what will
 * go out" rule is implemented as a confirm `Dialog` restating recipient,
 * channel and the full message — the pattern
 * `academic-years/-set-current-dialog.tsx` established.
 *
 * The permission check is a UX gate, not the security boundary
 * (`RolesGuard` server-side already 403s) — same framing as
 * `/fees/generate`'s gate.
 */
export const Route = createFileRoute('/_staff/communications/send')({
  component: SendMessagePage,
});

const SENDABLE_MEDIUMS = ['SMS', 'WHATSAPP', 'EMAIL'] as const;
type SendableMedium = (typeof SENDABLE_MEDIUMS)[number];

function SendMessagePage() {
  const { t } = useTranslation('communications');
  const navigate = useNavigate();
  const canSend = useHasPermission(Permission.COMMUNICATION_SEND);

  if (!canSend) {
    return (
      <EmptyState
        title={t('send.forbidden.title')}
        explanation={t('send.forbidden.explanation')}
        action={{
          label: t('send.forbidden.action'),
          onClick: () => void navigate({ to: '/dashboard' }),
        }}
      />
    );
  }

  return <SendMessageForm />;
}

/** Address a guardian is reachable at for the chosen channel — email for
 * EMAIL, phone otherwise. `null` means "no address on file", which the
 * picker shows rather than silently prefilling nothing. */
function guardianAddressFor(guardian: Guardian, medium: SendableMedium): string | null {
  return medium === 'EMAIL' ? guardian.email : guardian.phone;
}

function SendMessageForm() {
  const { t } = useTranslation('communications');
  const sendMessage = useSendCommunication();

  const [medium, setMedium] = React.useState<SendableMedium>('SMS');
  const [recipientName, setRecipientName] = React.useState('');
  const [recipientAddress, setRecipientAddress] = React.useState('');
  const [subject, setSubject] = React.useState('');
  const [messageBody, setMessageBody] = React.useState('');
  const [templateName, setTemplateName] = React.useState('');
  const [templateLanguage, setTemplateLanguage] = React.useState('');
  const [templateParams, setTemplateParams] = React.useState('');
  const [student, setStudent] = React.useState<Student | null>(null);
  const [guardianId, setGuardianId] = React.useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  // Refreshes the queued message's delivery status after the send — the
  // 201 body always says QUEUED (dispatch is async via BullMQ), so the
  // result panel reads the log entry for where the message actually is.
  const sentLog = useCommunicationLog(sendMessage.data?.id);

  function buildPayload(): SendCommunicationInput {
    const params = splitTemplateParams(templateParams);
    return {
      medium,
      recipient_address: recipientAddress.trim(),
      recipient_name: recipientName.trim(),
      message_body: messageBody,
      // `exactOptionalPropertyTypes` — omit rather than set `undefined`.
      ...(medium === 'EMAIL' && subject.trim() !== '' ? { subject: subject.trim() } : {}),
      ...(student !== null ? { student_id: student.id } : {}),
      ...(guardianId !== null ? { guardian_id: guardianId } : {}),
      ...(medium === 'WHATSAPP' && templateName.trim() !== ''
        ? {
            template_name: templateName.trim(),
            ...(templateLanguage.trim() !== ''
              ? { template_language: templateLanguage.trim() }
              : {}),
            ...(params.length > 0 ? { template_params: params } : {}),
          }
        : {}),
    };
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    sendMessage.reset();
    setConfirmOpen(true);
  }

  function handleConfirm() {
    sendMessage.mutate(buildPayload(), {
      onSuccess: () => setConfirmOpen(false),
    });
  }

  function handleSelectStudent(selected: Student) {
    setStudent(selected);
    setGuardianId(null);
  }

  function handlePickGuardian(guardian: Guardian) {
    setGuardianId(guardian.id);
    setRecipientName(guardian.full_name);
    // Always overwrite — leaving the previous guardian's address in
    // place would send this guardian's message to someone else's
    // phone/email while logging it against the new guardian. No address
    // for this channel → empty field the sender must fill.
    setRecipientAddress(guardianAddressFor(guardian, medium) ?? '');
  }

  // Finding its way here from the channel Select, not a bare setMedium:
  // the address field's *kind* follows the channel (phone for SMS/
  // WhatsApp, email for EMAIL), so a channel switch must not leave the
  // old channel's address sitting in the field.
  function handleMediumChange(value: SendableMedium) {
    const guardian = student?.guardians.find((candidate) => candidate.id === guardianId);
    if (guardian !== undefined) {
      // Re-derive from the selected guardian for the new channel.
      setRecipientAddress(guardianAddressFor(guardian, value) ?? '');
    } else if ((medium === 'EMAIL') !== (value === 'EMAIL')) {
      // Hand-typed address whose kind (phone vs email) no longer fits —
      // clear rather than let `type=tel` (no native validation) carry an
      // email into an SMS send.
      setRecipientAddress('');
    }
    setMedium(value);
  }

  function handleReset() {
    sendMessage.reset();
    setMessageBody('');
    setSubject('');
    setTemplateName('');
    setTemplateLanguage('');
    setTemplateParams('');
    setRecipientName('');
    setRecipientAddress('');
    setStudent(null);
    setGuardianId(null);
  }

  if (sendMessage.isSuccess) {
    const status = sentLog.data?.status ?? sendMessage.data.status;
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4 p-4">
        <h1 className="text-2xl font-semibold">{t('send.title')}</h1>
        <section
          aria-label={t('send.resultTitle')}
          className="flex flex-col gap-3 rounded-md border border-border p-4"
        >
          <h2 className="text-lg font-medium">{t('send.resultTitle')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('send.resultDescription', { name: sendMessage.data.recipient_name })}
          </p>
          <p className="flex items-center gap-2 text-sm">
            <span>{t('send.resultStatusLabel')}:</span>
            <StatusBadge domain="communication" status={status} />
          </p>
          <div>
            <Button type="button" onClick={handleReset}>
              {t('send.sendAnother')}
            </Button>
          </div>
        </section>
      </div>
    );
  }

  const selectedGuardian =
    student?.guardians.find((guardian) => guardian.id === guardianId) ?? null;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t('send.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('send.description')}</p>
      </header>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="send-medium">{t('send.mediumLabel')}</Label>
          <Select
            value={medium}
            onValueChange={(value) => handleMediumChange(value as SendableMedium)}
          >
            <SelectTrigger id="send-medium" aria-label={t('send.mediumLabel')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SENDABLE_MEDIUMS.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`mediums.${value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <section
          aria-label={t('send.linkStudentTitle')}
          className="flex flex-col gap-2 rounded-md border border-border p-3"
        >
          <h2 className="text-sm font-medium">{t('send.linkStudentTitle')}</h2>
          {student === null ? (
            <StudentSearch
              inputId="send-student-search"
              searchLabel={t('send.studentSearchLabel')}
              searchPlaceholder={t('send.studentSearchPlaceholder')}
              noResultsLabel={t('send.studentNoResults')}
              onSelect={handleSelectStudent}
            />
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm">
                  {student.full_name} · {student.registration_number}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setStudent(null);
                    setGuardianId(null);
                  }}
                >
                  {t('send.clearStudent')}
                </Button>
              </div>
              <RadioGroup
                aria-label={t('send.guardianListLabel', { name: student.full_name })}
                value={guardianId ?? ''}
                onValueChange={(value) => {
                  const guardian = student.guardians.find((candidate) => candidate.id === value);
                  if (guardian !== undefined) handlePickGuardian(guardian);
                }}
                className="flex flex-col gap-1.5"
              >
                {student.guardians.map((guardian) => {
                  const address = guardianAddressFor(guardian, medium);
                  const optionLabel = t('send.guardianOptionLabel', {
                    name: guardian.full_name,
                    relationship: guardian.relationship,
                  });
                  return (
                    <span key={guardian.id} className="flex items-center gap-2 text-sm">
                      <RadioGroupItem value={guardian.id} aria-label={optionLabel} />
                      <span>
                        {optionLabel}{' '}
                        <span className="text-muted-foreground">
                          — {address ?? t('send.guardianNoAddress')}
                        </span>
                      </span>
                    </span>
                  );
                })}
              </RadioGroup>
            </div>
          )}
        </section>

        <div className="grid gap-1.5">
          <Label htmlFor="send-recipient-name">{t('send.recipientNameLabel')}</Label>
          <Input
            id="send-recipient-name"
            value={recipientName}
            onChange={(event) => setRecipientName(event.target.value)}
            required
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="send-recipient-address">{t('send.recipientAddressLabel')}</Label>
          <Input
            id="send-recipient-address"
            type={medium === 'EMAIL' ? 'email' : 'tel'}
            value={recipientAddress}
            onChange={(event) => setRecipientAddress(event.target.value)}
            required
          />
        </div>

        {medium === 'EMAIL' && (
          <div className="grid gap-1.5">
            <Label htmlFor="send-subject">{t('send.subjectLabel')}</Label>
            <Input
              id="send-subject"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
            />
          </div>
        )}

        <div className="grid gap-1.5">
          <Label htmlFor="send-message">{t('send.messageLabel')}</Label>
          <Textarea
            id="send-message"
            value={messageBody}
            onChange={(event) => setMessageBody(event.target.value)}
            required
            rows={5}
          />
          {medium === 'SMS' && <SmsSegmentCounter text={messageBody} />}
        </div>

        {medium === 'WHATSAPP' && (
          <WhatsappTemplateFields
            idPrefix="send"
            helperText={t('send.whatsappHelper')}
            templateName={templateName}
            onTemplateNameChange={setTemplateName}
            templateLanguage={templateLanguage}
            onTemplateLanguageChange={setTemplateLanguage}
            templateParams={templateParams}
            onTemplateParamsChange={setTemplateParams}
          />
        )}

        <div>
          <Button type="submit">{t('send.submit')}</Button>
        </div>
      </form>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('send.confirmTitle')}</DialogTitle>
            <DialogDescription>{t('send.confirmDescription')}</DialogDescription>
          </DialogHeader>
          <dl className="grid gap-2 text-sm">
            <div className="grid gap-0.5">
              <dt className="font-medium">{t('send.confirmRecipientLabel')}</dt>
              <dd>
                {recipientName.trim()} — {recipientAddress.trim()}
              </dd>
            </div>
            <div className="grid gap-0.5">
              <dt className="font-medium">{t('send.confirmChannelLabel')}</dt>
              <dd>{t(`mediums.${medium}`)}</dd>
            </div>
            {medium === 'EMAIL' && subject.trim() !== '' && (
              <div className="grid gap-0.5">
                <dt className="font-medium">{t('send.confirmSubjectLabel')}</dt>
                <dd>{subject.trim()}</dd>
              </div>
            )}
            <div className="grid gap-0.5">
              <dt className="font-medium">{t('send.confirmMessageLabel')}</dt>
              <dd className="whitespace-pre-wrap">{messageBody}</dd>
            </div>
          </dl>
          {selectedGuardian !== null && (
            <p className="text-xs text-muted-foreground">
              {t('send.guardianOptionLabel', {
                name: selectedGuardian.full_name,
                relationship: selectedGuardian.relationship,
              })}
            </p>
          )}
          {sendMessage.isError && (
            <p role="alert" className="text-sm text-destructive">
              {/* 400s carry the server's own explanation (a WhatsApp
                  template rule, a malformed address) — surface it
                  verbatim rather than a generic failure line. */}
              {sendMessage.error instanceof ApiError && sendMessage.error.statusCode === 400
                ? sendMessage.error.message
                : t('send.errorMessage')}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('actions.cancel', { ns: 'common' })}
              </Button>
            </DialogClose>
            <Button type="button" loading={sendMessage.isPending} onClick={handleConfirm}>
              {sendMessage.isPending ? t('send.confirmSending') : t('send.confirmSend')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
