/**
 * [67.5.05] "Send an alert": a full-page form (severity, title, message, link,
 * audience, expiry) with a live recipient count and a preview of the bar, plus
 * the list of alerts already sent. The route file is 67.5.09.
 */
import type { AlertSeverity } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import {
  AlertSeverityBadge,
  AttentionBar,
  Card,
  ConfirmDialog,
  DatePicker,
  Input,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  toast,
} from '@biddaloy/ui/components';
import {
  isAudienceEmpty,
  useDebouncedValue,
  useManualAlertPreview,
  useSendManualAlert,
  type AttentionSummary,
  type ManualAudience,
} from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { FullPageShell } from '@biddaloy/ui/shells';
import {
  parseValidationFieldErrors,
  renderDigits,
  tenantTodayIso,
  toIsoDate,
} from '@biddaloy/ui/utils';
import { CircleAlert } from 'lucide-react';
import * as React from 'react';

import { AudiencePicker } from './audience-picker';
import { audienceKind, useLinkOptions } from './link-options';
import { SentAlertsCard } from './sent-alerts-card';

const TITLE_MAX = 140;
const MESSAGE_MAX = 500;
const MAX_DAYS_AHEAD = 30;
const SEVERITIES = ['WARNING', 'REMINDER'] as const;
const NO_LINK = '__none__';
const FIELDS = ['title', 'body', 'actionUrl', 'expiresOn'] as const;

function isoToDate(iso: string): Date {
  const [y = 0, m = 1, d = 1] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function FieldError({ message }: { message: string | undefined }) {
  if (!message) return null;
  return (
    <p role="alert" className="flex items-center gap-1 text-caption text-destructive">
      <CircleAlert className="size-3.5" aria-hidden="true" />
      {message}
    </p>
  );
}

export function SendAlertForm({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('attention');
  const { t: tCommon } = useTranslation('common');
  const config = useTenantRegionConfig();
  const fmt = (n: number) => renderDigits(String(n), config.numerals);

  const today = React.useMemo(() => isoToDate(tenantTodayIso(config)), [config]);
  const [severity, setSeverity] = React.useState<string>('WARNING');
  const [title, setTitle] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [link, setLink] = React.useState('');
  const [audience, setAudience] = React.useState<ManualAudience>({});
  const [expires, setExpires] = React.useState<Date | undefined>(() => addDays(today, 1));
  const [discardOpen, setDiscardOpen] = React.useState(false);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | undefined>();
  const inFlight = React.useRef(false);

  const send = useSendManualAlert();
  const preview = useManualAlertPreview(useDebouncedValue(audience, 400));
  const kind = audienceKind(audience);
  const linkOptions = useLinkOptions(kind, audience.roles);
  const actionUrl = linkOptions.some((o) => o.value === link) ? link : '';
  // The preview endpoint is rate-limited: on a failure (429) keep showing the last count, marked
  // as possibly out of date. While a new audience loads, `data` is still the old audience's count.
  const [lastCount, setLastCount] = React.useState<number | undefined>();
  React.useEffect(() => {
    if (preview.data) setLastCount(preview.data.recipientCount);
  }, [preview.data]);
  const count = isAudienceEmpty(audience)
    ? undefined
    : (preview.data?.recipientCount ?? (preview.isError ? lastCount : undefined));
  const countIsCurrent = !preview.isError && !preview.isPlaceholderData;

  const dirty = title !== '' || message !== '' || !isAudienceEmpty(audience);
  const reason = !title.trim()
    ? t('composer.needTitle')
    : !message.trim()
      ? t('composer.needMessage')
      : isAudienceEmpty(audience)
        ? t('composer.needAudience')
        : count === 0 && countIsCurrent
          ? t('composer.nobody')
          : undefined;

  async function submit() {
    if (reason || !expires || inFlight.current) return;
    inFlight.current = true;
    setFieldErrors({});
    setFormError(undefined);
    try {
      const sent = await send.mutateAsync({
        audience,
        severity: severity as 'WARNING' | 'REMINDER',
        title: title.trim(),
        body: message.trim(),
        ...(actionUrl ? { actionUrl } : {}),
        expiresOn: toIsoDate(expires),
      });
      toast.success(
        t('composer.sent', {
          count: sent.recipientCount,
          n: fmt(sent.recipientCount),
        }),
      );
      onClose();
    } catch (error) {
      const apiError = error instanceof ApiError ? error : undefined;
      const code = apiError?.details?.code;
      if (code === 'MANUAL_DAILY_LIMIT') {
        setFormError(t('composer.dailyLimit', { n: fmt(Number(apiError?.details?.limit)) }));
      } else if (apiError?.statusCode === 429) {
        // the per-minute throttler, not the daily cap
        setFormError(t('composer.tooFast'));
      } else if (code === 'MANUAL_NO_RECIPIENTS') {
        setFormError(t('composer.nobody'));
      } else if (code === 'MANUAL_EXPIRES_RANGE') {
        setFieldErrors({ expiresOn: t('composer.badDate', { n: fmt(MAX_DAYS_AHEAD) }) });
      } else if (apiError?.statusCode === 400) {
        // class-validator text is English: show our own per-field copy instead
        const errors: Record<string, string> = {};
        for (const field of Object.keys(parseValidationFieldErrors(apiError.messages, FIELDS))) {
          errors[field] = t(`composer.errors.${field}`);
        }
        setFieldErrors(errors);
        if (Object.keys(errors).length === 0) setFormError(tCommon('status.error'));
      } else {
        setFormError(tCommon('status.error'));
      }
    } finally {
      inFlight.current = false;
    }
  }

  // Ctrl/Cmd+Enter sends from anywhere in the page (the shell is a modal), but not while a
  // confirm dialog (the discard prompts, withdraw) is open on top of it.
  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.key === 'Enter' &&
        (event.ctrlKey || event.metaKey) &&
        !document.querySelector('[role="alertdialog"]')
      ) {
        event.preventDefault();
        void submit();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const previewSummary = {
    critical: 0,
    warning: severity === 'WARNING' ? 1 : 0,
    reminder: severity === 'REMINDER' ? 1 : 0,
    activeTotal: 1,
    top: title.trim() ? { title: title.trim() } : null,
    updatedAt: null,
    staleMinutes: 0,
  } as AttentionSummary;

  return (
    <>
      <FullPageShell
        title={t('composer.title')}
        size="wide"
        dirty={dirty}
        onClose={onClose}
        secondary={{
          label: t('composer.cancel'),
          // The footer's secondary bypasses the shell's dirty check.
          onClick: () => (dirty ? setDiscardOpen(true) : onClose()),
        }}
        primary={{
          label: t('composer.send'),
          busy: send.isPending,
          disabled: reason !== undefined,
          onClick: () => void submit(),
        }}
      >
        <div className="flex flex-col gap-6">
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
            className="flex flex-col gap-6"
          >
            <Card padded aria-labelledby="alert-what" className="flex flex-col gap-4">
              <div>
                <h2 id="alert-what" className="text-h2">
                  {t('composer.whatTitle')}
                </h2>
                <p className="mt-1 text-text-secondary">{t('composer.whatHelp')}</p>
              </div>

              <fieldset className="flex flex-col gap-2">
                <legend id="alert-severity" className="mb-2 text-label">
                  {t('composer.severityLabel')}
                </legend>
                <RadioGroup
                  value={severity}
                  onValueChange={setSeverity}
                  aria-labelledby="alert-severity"
                >
                  {SEVERITIES.map((s) => (
                    <div
                      key={s}
                      className={`flex min-h-11 items-start gap-3 rounded-md border p-3 ${
                        severity === s
                          ? 'border-primary bg-secondary'
                          : 'border-border-functional bg-surface'
                      }`}
                    >
                      <RadioGroupItem
                        id={`severity-${s}`}
                        value={s}
                        aria-describedby={`severity-${s}-help`}
                      />
                      <div className="flex flex-col gap-1">
                        <label htmlFor={`severity-${s}`} className="cursor-pointer">
                          <AlertSeverityBadge severity={s as AlertSeverity} />
                        </label>
                        <p id={`severity-${s}-help`} className="text-caption text-text-secondary">
                          {t(s === 'WARNING' ? 'composer.warningHelp' : 'composer.reminderHelp')}
                        </p>
                      </div>
                    </div>
                  ))}
                </RadioGroup>
                <p className="text-caption text-text-secondary">{t('composer.criticalNote')}</p>
              </fieldset>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="alert-title-input" className="text-label">
                  {t('composer.titleLabel')}
                </label>
                <Input
                  id="alert-title-input"
                  value={title}
                  maxLength={TITLE_MAX}
                  onChange={(e) => setTitle(e.target.value)}
                  aria-invalid={fieldErrors.title ? true : undefined}
                />
                <span className="text-caption text-text-secondary">
                  {t('composer.counter', {
                    used: fmt(title.length),
                    max: fmt(TITLE_MAX),
                  })}
                </span>
                <FieldError message={fieldErrors.title} />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="alert-message-input" className="text-label">
                  {t('composer.messageLabel')}
                </label>
                <Textarea
                  id="alert-message-input"
                  value={message}
                  maxLength={MESSAGE_MAX}
                  rows={4}
                  onChange={(e) => setMessage(e.target.value)}
                  aria-invalid={fieldErrors.body ? true : undefined}
                />
                <span className="text-caption text-text-secondary">
                  {t('composer.counter', {
                    used: fmt(message.length),
                    max: fmt(MESSAGE_MAX),
                  })}
                </span>
                <FieldError message={fieldErrors.body} />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="alert-link-select" className="text-label">
                  {t('composer.linkLabel')}
                </label>
                <Select
                  value={actionUrl === '' ? NO_LINK : actionUrl}
                  onValueChange={(v) => setLink(v === NO_LINK ? '' : v)}
                  disabled={kind === 'mixed'}
                >
                  <SelectTrigger id="alert-link-select" aria-describedby="alert-link-help">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_LINK}>{t('composer.linkNone')}</SelectItem>
                    {linkOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {kind === 'mixed' && (
                  <p id="alert-link-help" className="text-caption text-text-secondary">
                    {t('composer.linkMixed')}
                  </p>
                )}
                <FieldError message={fieldErrors.actionUrl} />
              </div>
            </Card>

            <Card padded aria-labelledby="alert-who" className="flex flex-col gap-4">
              <div>
                <h2 id="alert-who" className="text-h2">
                  {t('composer.whoTitle')}
                </h2>
                <p className="mt-1 text-text-secondary">{t('composer.whoHelp')}</p>
              </div>
              <AudiencePicker value={audience} onChange={setAudience} />
              <div
                aria-live="polite"
                className="rounded-md border border-border-subtle bg-muted p-3"
              >
                {count === undefined ? null : count === 0 && countIsCurrent ? (
                  <p>{t('composer.nobody')}</p>
                ) : (
                  <>
                    <p className="text-label">
                      {t('composer.recipients', { count, n: fmt(count) })}
                    </p>
                    <p className="text-caption text-text-secondary">
                      {preview.isError ? t('composer.countStale') : t('composer.onceNote')}
                    </p>
                  </>
                )}
              </div>
            </Card>

            <Card padded aria-labelledby="alert-until" className="flex flex-col gap-1.5">
              <h2 id="alert-until" className="text-h2">
                {t('composer.untilTitle')}
              </h2>
              <label htmlFor="alert-expires" className="mt-2 text-label">
                {t('composer.expiresLabel')}
              </label>
              <DatePicker
                id="alert-expires"
                aria-label={t('composer.expiresLabel')}
                config={config}
                value={expires}
                onValueChange={setExpires}
                min={today}
                max={addDays(today, MAX_DAYS_AHEAD)}
                clearable={false}
              />
              <p className="text-caption text-text-secondary">{t('composer.expiresHelp')}</p>
              <FieldError message={fieldErrors.expiresOn} />
            </Card>
          </form>

          <Card padded aria-labelledby="alert-preview" className="flex flex-col gap-3">
            <h2 id="alert-preview" className="text-h2">
              {t('composer.previewTitle')}
            </h2>
            {/* Decorative copy of the bar: inert keeps it out of the tab order and the a11y tree. */}
            <div inert aria-hidden="true">
              <AttentionBar summary={previewSummary} onOpen={() => undefined} />
            </div>
          </Card>

          <div role="status" className="text-caption text-text-secondary">
            {reason ?? t('composer.sendHint')}
          </div>
          {formError && <FieldError message={formError} />}

          <SentAlertsCard />
        </div>
      </FullPageShell>
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title={t('composer.discardTitle')}
        description={t('composer.discardBody')}
        confirmLabel={t('composer.discard')}
        cancelLabel={tCommon('fullPage.keepEditing')}
        tone="danger"
        onConfirm={onClose}
      />
    </>
  );
}
