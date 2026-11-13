import {
  Button,
  Card,
  Checkbox,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@biddaloy/ui/components';
import type { SendAnnouncementInput } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

const TITLE_MAX = 140;
const MESSAGE_MAX = 500;
const FILTERS = ['ACTIVE', 'SUSPENDED', 'ALL'] as const;
const SEVERITIES = ['REMINDER', 'WARNING'] as const;
type Filter = (typeof FILTERS)[number];
type Severity = (typeof SEVERITIES)[number];

export const toStatusFilter = (f: Filter): SendAnnouncementInput['statusFilter'] =>
  f === 'ALL' ? ['ACTIVE', 'SUSPENDED'] : [f];

export type PreviewState =
  { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; schools: number; people: number };

export interface ComposeFormProps {
  preview: PreviewState;
  /** Called on mount and whenever the school filter changes. */
  onFilterChange: (statusFilter: SendAnnouncementInput['statusFilter']) => void;
  onRetryPreview: () => void;
  /** The page guards a double click as well. */
  onSend: (input: SendAnnouncementInput) => void;
  busy?: boolean;
  /** Fields are frozen while a request waits for the other owner. */
  locked?: boolean;
}

/** One message, the schools it goes to, how many that is, and a note that a second owner must agree. */
export function ComposeForm({
  preview,
  onFilterChange,
  onRetryPreview,
  onSend,
  busy,
  locked,
}: ComposeFormProps) {
  const { t } = useTranslation('platformAnnouncements');
  const [filter, setFilter] = React.useState<Filter>('ACTIVE');
  const [severity, setSeverity] = React.useState<Severity>('REMINDER');
  const [title, setTitle] = React.useState('');
  const [body, setBody] = React.useState('');
  const [sms, setSms] = React.useState(false);
  const [email, setEmail] = React.useState(false);

  React.useEffect(() => {
    onFilterChange(toStatusFilter(filter));
    // The parent's callback is stable per page; the filter is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const nobody = preview.kind === 'ready' && preview.schools === 0;
  const reason = !title.trim()
    ? t('compose.needTitle')
    : !body.trim()
      ? t('compose.needMessage')
      : undefined;
  // Sending or awaiting approval: freeze the fields so the form always matches the pending payload.
  const frozen = !!(busy || locked);
  const disabled = frozen || reason !== undefined || preview.kind !== 'ready' || nobody;

  return (
    <Card padded aria-labelledby="ann-compose-title" className="flex flex-col gap-4">
      <h2 id="ann-compose-title" className="text-h2">
        {t('compose.title')}
      </h2>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (disabled) return;
          onSend({
            title: title.trim(),
            body: body.trim(),
            severity,
            statusFilter: toStatusFilter(filter),
            sms,
            email,
          });
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="ann-filter" className="text-label">
            {t('compose.filterLabel')}
          </label>
          <Select value={filter} onValueChange={(v) => setFilter(v as Filter)} disabled={frozen}>
            <SelectTrigger id="ann-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FILTERS.map((f) => (
                <SelectItem key={f} value={f}>
                  {t(`compose.filter.${f}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div role="status" className="text-text-secondary">
            {preview.kind === 'loading' && t('preview.loading')}
            {preview.kind === 'ready' &&
              (nobody
                ? t('preview.none')
                : t('preview.result', { schools: preview.schools, people: preview.people }))}
            {preview.kind === 'error' && (
              <span className="flex flex-wrap items-center gap-2">
                <span role="alert">{t('preview.error')}</span>
                <Button type="button" variant="outline" onClick={onRetryPreview}>
                  {t('preview.retry')}
                </Button>
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="ann-severity" className="text-label">
            {t('compose.severityLabel')}
          </label>
          <Select
            value={severity}
            onValueChange={(v) => setSeverity(v as Severity)}
            disabled={frozen}
          >
            <SelectTrigger id="ann-severity">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SEVERITIES.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`compose.severity.${s}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="ann-title" className="text-label">
            {t('compose.titleLabel')}
          </label>
          <Input
            id="ann-title"
            value={title}
            maxLength={TITLE_MAX}
            disabled={frozen}
            onChange={(e) => setTitle(e.target.value)}
          />
          <span className="text-caption text-text-secondary">
            {t('compose.counter', { used: title.length, max: TITLE_MAX })}
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="ann-message" className="text-label">
            {t('compose.messageLabel')}
          </label>
          <Textarea
            id="ann-message"
            value={body}
            rows={4}
            maxLength={MESSAGE_MAX}
            disabled={frozen}
            onChange={(e) => setBody(e.target.value)}
          />
          <span className="text-caption text-text-secondary">
            {t('compose.counter', { used: body.length, max: MESSAGE_MAX })}
          </span>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-label">{t('compose.channelsLabel')}</legend>
          <div className="flex min-h-11 items-center gap-2">
            <Checkbox id="ann-banner" checked disabled />
            <label htmlFor="ann-banner">{t('compose.channelBanner')}</label>
          </div>
          <div className="flex min-h-11 items-center gap-2">
            <Checkbox
              id="ann-sms"
              checked={sms}
              disabled={frozen}
              onCheckedChange={(v) => setSms(v === true)}
            />
            <label htmlFor="ann-sms">{t('compose.channelSms')}</label>
          </div>
          <div className="flex min-h-11 items-center gap-2">
            <Checkbox
              id="ann-email"
              checked={email}
              disabled={frozen}
              onCheckedChange={(v) => setEmail(v === true)}
            />
            <label htmlFor="ann-email">{t('compose.channelEmail')}</label>
          </div>
        </fieldset>

        <p className="text-text-secondary">{t('preview.needsAgreement')}</p>
        <div className="flex justify-end">
          <Button type="submit" size="lg" disabled={disabled}>
            {t('compose.send')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
