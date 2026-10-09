/**
 * [52.5.1] D33/D35: approve many inbox rows at once. FEE_WAIVER rows are never sent (they need a
 * step-up on their own); every failed row is explained with a translated code, never a server string.
 */
import { ApplicationType } from '@biddaloy/shared';
import { Button, Card, ConfirmDialog } from '@biddaloy/ui/components';
import {
  useBulkApproveApplications,
  type ApplicationListItemDto,
  type BulkApproveResult,
} from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { CircleCheckIcon, XIcon } from 'lucide-react';
import * as React from 'react';

export const BULK_APPROVE_LIMIT = 50;

export interface BulkSummary {
  total: number;
  ok: number;
  failed: { id: string; name: string; serial: string; code: string | undefined }[];
}

const KNOWN_CODES = new Set([
  'NOT_BULK_APPROVABLE',
  'NOT_A_DECIDER',
  'APPLICATION_NOT_OPEN',
  'APPLICATION_CHANGED',
  'LEAVE_BALANCE_EXCEEDED',
  'EFFECT_PERMISSION_REQUIRED',
  'NOT_FOUND',
]);

export function summarizeBulk(
  rows: readonly ApplicationListItemDto[],
  results: readonly BulkApproveResult[],
): BulkSummary {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return {
    total: results.length,
    ok: results.filter((r) => r.ok).length,
    failed: results
      .filter((r) => !r.ok)
      .map((r) => ({
        id: r.id,
        name: byId.get(r.id)?.applicant_name ?? '',
        serial: byId.get(r.id)?.serial ?? '',
        code: r.error_code,
      })),
  };
}

export function BulkApproveButton({
  selectedCount,
  rows,
  onDone,
}: {
  /** Everything selected (the 50 cap counts all of it). */
  selectedCount: number;
  /** Selected rows currently on screen. */
  rows: readonly ApplicationListItemDto[];
  onDone: (summary: BulkSummary) => void;
}) {
  const { t } = useTranslation('applicationsList');
  const config = useTenantRegionConfig();
  const [open, setOpen] = React.useState(false);
  const bulk = useBulkApproveApplications();
  const reasonId = React.useId();
  const tooMany = selectedCount > BULK_APPROVE_LIMIT;
  const sendable = rows.filter(
    (r) => (r.type as string) !== (ApplicationType.FEE_WAIVER as string),
  );
  const excluded = rows.length - sendable.length;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={tooMany || sendable.length === 0}
        aria-describedby={tooMany ? reasonId : undefined}
        onClick={() => setOpen(true)}
      >
        <CircleCheckIcon className="size-4 text-status-paid-fg" aria-hidden />
        {t('bulk.approve')}
      </Button>
      {tooMany && (
        <p id={reasonId} className="text-caption text-muted-foreground">
          {t('bulk.limit')}
        </p>
      )}
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        tone="default"
        title={t('bulk.confirmTitle', {
          count: sendable.length,
          n: formatNumber(sendable.length, config),
        })}
        description={
          excluded > 0
            ? `${t('bulk.confirmBody')} ${t('bulk.feeWaiverExcluded', { n: formatNumber(excluded, config) })}`
            : t('bulk.confirmBody')
        }
        confirmLabel={t('bulk.confirm')}
        busy={bulk.isPending}
        onConfirm={() =>
          bulk.mutate(
            { ids: sendable.map((r) => r.id) },
            {
              onSuccess: (results) => {
                setOpen(false);
                onDone(summarizeBulk(rows, results));
              },
            },
          )
        }
      />
    </>
  );
}

export function BulkResultCard({
  summary,
  onClose,
}: {
  summary: BulkSummary;
  onClose: () => void;
}) {
  const { t } = useTranslation('applicationsList');
  const config = useTenantRegionConfig();
  return (
    <Card role="status" padded className="space-y-2">
      <p className="font-medium">
        {t('bulk.resultTitle', {
          total: formatNumber(summary.total, config),
          ok: formatNumber(summary.ok, config),
        })}
      </p>
      {summary.failed.length > 0 && (
        <ul className="list-disc space-y-1 ps-5 text-muted-foreground">
          {summary.failed.map((f) => (
            <li key={f.id}>
              {t('bulk.failedLine', {
                name: f.name,
                serial: f.serial,
                reason: t(`errors.${f.code && KNOWN_CODES.has(f.code) ? f.code : 'unknown'}`),
              })}
            </li>
          ))}
        </ul>
      )}
      <Button type="button" variant="ghost" onClick={onClose}>
        <XIcon className="size-4" aria-hidden />
        {t('bulk.dismiss')}
      </Button>
    </Card>
  );
}
