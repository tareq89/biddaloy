import { ApplicationStatus } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
/** [52.5.2] The letter, its details and the attachments. */
import { Button, Card, ConfirmDialog } from '@biddaloy/ui/components';
import {
  downloadApplicationAttachment,
  useDeleteApplicationAttachment,
  type ApplicationAttachmentDto,
  type ApplicationDto,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, formatNumber } from '@biddaloy/ui/utils';
import type { TFunction } from 'i18next';
import { DownloadIcon, FileIcon, Trash2Icon } from 'lucide-react';
import * as React from 'react';

import { LetterPreview } from '../../../../features/applications/letter-preview';

/** The FEE_WAIVER fields an approver can change when granting (D39). */
const GRANT_KEYS = ['kind', 'value', 'fee_types', 'start_date', 'end_date'] as const;

/** Payload key -> label key in `applicationForms:fields`; keys not listed are not shown. */
const LABEL: Record<string, string> = {
  leave_type: 'leaveType',
  reason_kind: 'reasonKind',
  start_date: 'startDate',
  end_date: 'endDate',
  reason: 'reason',
  details: 'details',
  kind: 'kind',
  fee_types: 'feeTypes',
  purpose: 'purpose',
  leaving_date: 'leavingDate',
  destination: 'destination',
  class_section_id: 'class',
  occurred_on: 'occurredOn',
  to_section_id: 'toSection',
  exam_id: 'exam',
  subject_id: 'subject',
  subject_line: 'subjectLine',
  body: 'body',
};
const text = (v: unknown): string =>
  typeof v === 'string' || typeof v === 'number' ? String(v) : '';
const DATE_KEYS = new Set(['start_date', 'end_date', 'leaving_date', 'occurred_on']);
const REF_KEYS = new Set(['class_section_id', 'to_section_id', 'exam_id', 'subject_id']);

function amountText(
  granted: Record<string, unknown>,
  t: TFunction,
  config: ReturnType<typeof useRegionConfig>,
) {
  const n = formatNumber(Number(granted.value), config);
  return granted.kind === 'PERCENT' ? t('body.percent', { n }) : t('body.flat', { n });
}

const LIMIT = 'APPLICATION_ATTACHMENT_LIMIT';
function removeErrorKey(error: unknown): string {
  const code =
    error instanceof ApiError ? (error.details as { code?: string } | undefined)?.code : '';
  return code === LIMIT ? `body.errors.${LIMIT}` : 'body.deleteFailed';
}

function Attachments({ app }: { app: ApplicationDto }) {
  const { t } = useTranslation('applicationsDetail');
  const config = useRegionConfig();
  const remove = useDeleteApplicationAttachment();
  const [deleting, setDeleting] = React.useState<ApplicationAttachmentDto | null>(null);
  const [failed, setFailed] = React.useState(false);
  // The applicant may remove files while the application still waits.
  const canDelete = app.can.withdraw && app.status === 'PENDING';

  if (app.attachments.length === 0) return null;
  return (
    <section className="space-y-2">
      <h3 className="text-h3">{t('body.attachments')}</h3>
      <ul className="divide-y divide-border-subtle">
        {app.attachments.map((file) => (
          <li key={file.id} className="flex min-h-11 items-center gap-3 py-1">
            <FileIcon aria-hidden="true" className="size-4 shrink-0 text-text-secondary" />
            <span className="min-w-0 flex-1 truncate">{file.file_name}</span>
            <span className="text-caption text-text-secondary">
              {t('body.sizeKb', { n: formatNumber(Math.ceil(file.size_bytes / 1024), config) })}
            </span>
            <Button
              type="button"
              variant="ghost"
              iconOnly
              aria-label={t('body.download', { file: file.file_name })}
              onClick={() => {
                setFailed(false);
                downloadApplicationAttachment(app.id, file).catch(() => setFailed(true));
              }}
            >
              <DownloadIcon aria-hidden="true" />
            </Button>
            {canDelete && (
              <Button
                type="button"
                variant="ghost"
                iconOnly
                aria-label={t('body.delete', { file: file.file_name })}
                onClick={() => setDeleting(file)}
              >
                <Trash2Icon aria-hidden="true" />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {remove.isError && (
        <p role="alert" className="text-caption text-destructive">
          {t(removeErrorKey(remove.error))}
        </p>
      )}
      {failed && (
        <p role="alert" className="text-caption text-destructive">
          {t('body.downloadFailed')}
        </p>
      )}
      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDeleting(null)}
          title={t('body.deleteTitle')}
          description={t('body.deleteDescription')}
          confirmLabel={t('body.deleteConfirm')}
          cancelLabel={t('body.deleteCancel')}
          busy={remove.isPending}
          onConfirm={() =>
            remove.mutate(
              { id: app.id, attachmentId: deleting.id },
              { onSettled: () => setDeleting(null) },
            )
          }
        />
      )}
    </section>
  );
}

export function ApplicationBody({ app }: { app: ApplicationDto }) {
  const { t } = useTranslation('applicationsDetail');
  const { t: tForms } = useTranslation('applicationForms');
  const config = useRegionConfig();
  const display = useDisplayValue(app);
  const decided = app.decided_at !== null && app.decided_by_name !== null;

  const rows = Object.entries(app.payload)
    .filter(([key]) => key in LABEL)
    .map(([key, value]) => ({
      key,
      label: tForms(`fields.${LABEL[key]}`),
      text: display(key, value),
    }));
  // FEE_WAIVER: show the amount asked for, and what was approved if that differs (D39).
  const asked = app.payload.value !== undefined ? app.payload : null;
  const granted = app.granted;
  if (asked)
    rows.push({ key: 'value', label: t('body.value'), text: amountText(asked, t, config) });
  // Only the amount fields: the payload also carries `reason`, which `granted` never has.
  const differs = (g: Record<string, unknown>, a: Record<string, unknown> | null) =>
    GRANT_KEYS.some((k) => JSON.stringify(g[k] ?? null) !== JSON.stringify(a?.[k] ?? null));
  if (granted && differs(granted, asked)) {
    rows.push({
      key: 'granted',
      label: t('body.grantedAmount'),
      text: amountText(granted, t, config),
    });
  }

  return (
    <div className="space-y-4">
      <Card padded className="space-y-3">
        <div>
          <h2 className="text-h2">{t('body.letterTitle')}</h2>
          <p className="text-caption text-text-secondary">{t('body.letterCaption')}</p>
        </div>
        <LetterPreview
          text={app.letter_text}
          {...(decided && (app.status === 'APPROVED' || app.status === 'REJECTED')
            ? {
                decision: {
                  status: app.status as ApplicationStatus,
                  by: app.decided_by_name as string,
                  at: app.decided_at as string,
                  ...(lastNote(app) ? { note: lastNote(app) as string } : {}),
                },
              }
            : {})}
        />
      </Card>
      <Card padded className="space-y-4">
        <h2 className="text-h2">{t('body.fieldsTitle')}</h2>
        <dl className="grid gap-4 md:grid-cols-3">
          {rows.map((row) => (
            <div key={row.key} className="min-w-0">
              <dt className="text-caption text-text-secondary">{row.label}</dt>
              <dd className="break-words">{row.text}</dd>
            </div>
          ))}
        </dl>
        <Attachments app={app} />
      </Card>
    </div>
  );
}

/** The deciding note (approval or rejection reason), shown under the letter. */
function lastNote(app: ApplicationDto): string | null {
  const last = [...app.events].reverse().find((e) => e.kind === app.status);
  return last?.note ?? null;
}

function useDisplayValue(app: Pick<ApplicationDto, 'ref_names'>) {
  const { t: tApp } = useTranslation('applications');
  const { t: tForms } = useTranslation('applicationForms');
  const { t: tLeave } = useTranslation('leave');
  const { t: tFee } = useTranslation('feeStructures');
  const config = useRegionConfig();

  // Dates are `YYYY-MM-DD`; references show their name, never an id (P4).
  return (key: string, value: unknown): string => {
    if (value === null || value === undefined || value === '') return '—';
    if (DATE_KEYS.has(key)) return formatDate(text(value), config);
    if (REF_KEYS.has(key)) return app.ref_names[key] ?? '—';
    if (key === 'leave_type') return tLeave(`type.${text(value)}`);
    if (key === 'reason_kind') return tApp(`reasons.${text(value)}`);
    if (key === 'kind') return tForms(`kinds.${text(value)}`);
    if (key === 'fee_types' && Array.isArray(value))
      return value.map((v) => tFee(`feeTypes.${text(v)}`)).join(', ') || '—';
    if (key === 'value') return formatNumber(Number(value), config);
    return text(value);
  };
}
