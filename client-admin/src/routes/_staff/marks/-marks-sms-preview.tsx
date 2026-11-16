/**
 * [80.3.03] The marks SMS review: how many guardians get one, what it costs, who is left out
 * and why, then Send. Nothing is sent before the teacher has seen this (D3, D10).
 *
 * The server answers with English sentences; every message here is our own words, mapped from
 * the status and `details`, never echoed (Rules 23/24).
 */
import { ApiError } from '@biddaloy/ui/api';
import { Button, Card, NoticeBar } from '@biddaloy/ui/components';
import {
  useMarksSmsPreview,
  useSendMarksSms,
  type MarksSmsGrid,
  type MarksSmsPreview,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDateTime, formatNumber } from '@biddaloy/ui/utils';
import * as React from 'react';

export interface MarksSmsPreviewProps {
  grid: MarksSmsGrid;
  /** Names for the skipped list, by student id. */
  studentNames: ReadonlyMap<string, string>;
  /** False while the exam is not PUBLISHED: guardians get marks before the results are out. */
  examPublished: boolean;
}

/** Our own sentence for a failed call. A 409 is "short credit" or "not submitted". */
export function marksSmsErrorKey(
  error: unknown,
  fallback: 'previewFailed' | 'sendFailed',
): 'shortCredit' | 'notSubmitted' | 'forbidden' | 'previewFailed' | 'sendFailed' {
  if (!(error instanceof ApiError)) return fallback;
  if (error.statusCode === 403) return 'forbidden';
  if (error.statusCode === 409) {
    return error.details?.['code'] === 'INSUFFICIENT_SMS_CREDIT' ? 'shortCredit' : 'notSubmitted';
  }
  return fallback;
}

export function MarksSmsPreviewPanel({ grid, studentNames, examPublished }: MarksSmsPreviewProps) {
  const { t } = useTranslation('marksSms');
  const config = useRegionConfig();
  const n = (v: number) => formatNumber(v, config);
  const preview = useMarksSmsPreview(grid);
  const send = useSendMarksSms(grid);
  const { mutate: runPreview } = preview;

  React.useEffect(() => {
    runPreview();
  }, [runPreview]);

  const result: MarksSmsPreview | undefined = preview.data;
  // A repeat click that finds nobody new answers with the earlier send's date (D10).
  const sentAt = send.data?.already_sent_at ?? result?.already_sent_at ?? null;
  const justSent = send.data !== undefined && send.data.queued > 0;
  const skipped = (send.data ?? result)?.skipped ?? [];

  const errorKey = send.isError
    ? marksSmsErrorKey(send.error, 'sendFailed')
    : preview.isError
      ? marksSmsErrorKey(preview.error, 'previewFailed')
      : undefined;
  const required = send.error instanceof ApiError ? send.error.details?.['required'] : undefined;
  const available = send.error instanceof ApiError ? send.error.details?.['available'] : undefined;

  return (
    <div className="flex flex-col gap-4">
      {!examPublished && <NoticeBar tone="warning">{t('notPublished')}</NoticeBar>}

      <Card padded role="region" aria-label={t('title')}>
        {preview.isPending && <p role="status">{t('loading')}</p>}

        {errorKey && (
          <div className="flex flex-col items-start gap-3">
            <NoticeBar tone="danger">
              {t(`errors.${errorKey}`, {
                required: typeof required === 'number' ? n(required) : '',
                available: typeof available === 'number' ? n(available) : '',
              })}
            </NoticeBar>
            {preview.isError && !send.isError && (
              <Button type="button" variant="outline" onClick={() => runPreview()}>
                {t('retry')}
              </Button>
            )}
          </div>
        )}

        {result && !justSent && (
          <div className="flex flex-col gap-3">
            {result.count > 0 ? (
              <p className="text-h2">
                {t('counts', { count: result.count, credits: n(result.segments) })}
              </p>
            ) : (
              <p className="text-h2">{t('none')}</p>
            )}
            {sentAt && (
              <>
                <p role="status" className="font-medium">
                  {t('alreadySent', { date: formatDateTime(sentAt, config) })}
                </p>
                <p className="text-text-secondary">{t('alreadySentNote')}</p>
              </>
            )}
          </div>
        )}

        {justSent && send.data && (
          <p role="status" className="text-h2">
            {t('sent', { count: send.data.queued, credits: n(send.data.segments) })}
          </p>
        )}
      </Card>

      {skipped.length > 0 && (
        <Card padded role="region" aria-label={t('skippedTitle')}>
          <h2 className="text-label">{t('skippedTitle')}</h2>
          <ul className="mt-2 flex flex-col gap-2">
            {skipped.map((s) => (
              <li key={s.student_id} className="flex flex-col md:flex-row md:justify-between">
                <span className="font-medium">{studentNames.get(s.student_id) ?? '—'}</span>
                <span className="text-text-secondary">{t(`reason.${s.reason}`)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {!justSent && (
        <div>
          <Button
            type="button"
            className="min-h-11 w-full md:w-auto"
            loading={send.isPending}
            disabled={
              !result ||
              result.count === 0 ||
              send.isPending ||
              (send.data?.queued === 0 && !!send.data.already_sent_at)
            }
            onClick={() => send.mutate()}
          >
            {t('send')}
          </Button>
        </div>
      )}
    </div>
  );
}
