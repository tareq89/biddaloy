/**
 * [32.3.5] A compact "what has been printed for this person" list, for the
 * Documents tabs on a student / staff page (#1158 mounts it). View and Reprint
 * only — revoking is an admin task done from the full history.
 */
import { Permission } from '@biddaloy/shared';
import { Button, Skeleton } from '@biddaloy/ui/components';
import {
  useHasPermission,
  useSubjectPrintHistory,
  type PrintHistoryRow,
  type PrintSubjectType,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDateTime } from '@biddaloy/ui/utils';
import * as React from 'react';

import { HistoryItemDialog } from './history-item-dialog';
import { Pill } from './print-history-page';
import { ReprintDialog } from './reprint-dialog';

export interface SubjectPrintHistoryProps {
  subjectType: PrintSubjectType;
  subjectId: string;
}

export function SubjectPrintHistory({ subjectType, subjectId }: SubjectPrintHistoryProps) {
  const { t } = useTranslation('printHistory');
  const region = useRegionConfig();
  const canPrint = useHasPermission(Permission.DOCUMENT_PRINT);
  const query = useSubjectPrintHistory(subjectType, subjectId);
  const [viewId, setViewId] = React.useState<string | undefined>(undefined);
  const [reprintRow, setReprintRow] = React.useState<PrintHistoryRow | undefined>(undefined);

  if (query.isPending)
    return <Skeleton role="status" aria-label={t('item.loading')} className="h-16 w-full" />;
  if (query.isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t('subject.error')}
      </p>
    );
  }
  const rows = query.data;
  if (rows.length === 0) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t('subject.empty')}
      </p>
    );
  }

  return (
    <section aria-label={t('subject.title')} className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">{t('subject.title')}</h3>
      <ul className="flex flex-col divide-y divide-border-subtle rounded-lg border border-border-subtle">
        {rows.map((row) => (
          <li
            key={row.item_id}
            className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
          >
            <div className="flex flex-col">
              <span className="font-medium">
                {t('documentValue', { name: row.template_name, version: row.template_version })} ·{' '}
                {t('copyValue', { n: row.copy_number })}
              </span>
              <span className="text-muted-foreground">
                {formatDateTime(new Date(row.created_at), region)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Pill tone={row.revoked_at ? 'bad' : 'good'}>
                {row.revoked_at ? t('status.REVOKED') : t('status.VALID')}
              </Pill>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setViewId(row.item_id)}
              >
                {t('actions.view')}
              </Button>
              {canPrint && !row.revoked_at ? (
                <Button type="button" size="sm" variant="ghost" onClick={() => setReprintRow(row)}>
                  {t('actions.reprint')}
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      <HistoryItemDialog
        open={viewId !== undefined}
        onOpenChange={(open) => !open && setViewId(undefined)}
        itemId={viewId}
        {...(canPrint
          ? {
              onReprint: (item) => {
                setViewId(undefined);
                setReprintRow(item);
              },
            }
          : {})}
      />
      {reprintRow ? (
        <ReprintDialog
          open
          onOpenChange={(open) => !open && setReprintRow(undefined)}
          row={reprintRow}
        />
      ) : null}
    </section>
  );
}
