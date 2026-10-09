/**
 * [38.4.3] Columns and row actions for the `/fees/fines` list.
 */
import type { FeeStatus } from '@biddaloy/shared';
import {
  StatusBadge,
  type RowAction,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import type { Fine } from '@biddaloy/ui/hooks';
import type { RegionConfig } from '@biddaloy/ui/i18n';
import { formatDate, formatMonth, formatServerAmount, parseServerDate } from '@biddaloy/ui/utils';
import type { TFunction } from 'i18next';
import { BadgeMinus } from 'lucide-react';

function truncatedReason(note: string | null): { short: string; full: string } | null {
  if (!note) return null;
  const short = note.length > 40 ? `${note.slice(0, 40)}…` : note;
  return { short, full: note };
}

function fineOrigin(fine: Fine): 'RULE' | 'MANUAL' {
  return fine.origin ?? 'MANUAL';
}

export interface FineRowActionOptions {
  onWaive: (fine: Fine) => void;
  /** Waiving needs FEE_APPROVE; without it the row action is hidden. */
  canWaive: boolean;
}

export function buildFineRowActions(
  t: TFunction<'fines', undefined>,
  { onWaive, canWaive }: FineRowActionOptions,
): (row: Fine) => RowAction[] {
  return (row) => [
    {
      intent: 'view',
      label: t('openStudent', { ns: 'fines' }),
      to: `/students/${row.student_id}`,
    },
    {
      intent: 'edit',
      icon: <BadgeMinus />,
      label: t('waiveDialog.confirm', { ns: 'fines' }),
      onClick: () => onWaive(row),
      allowed: canWaive && row.status !== 'WAIVED' && row.status !== 'PAID',
    },
  ];
}

export function buildFinesColumns(
  t: TFunction<'fines', undefined>,
  regionConfig: RegionConfig,
): DataTableColumn<Fine>[] {
  return [
    {
      id: 'student',
      header: t('columns.student', { ns: 'fines' }),
      accessorFn: (row) => <span className="font-medium">{row.student_name ?? '—'}</span>,
      card: 'title',
    },
    {
      id: 'fine',
      header: t('columns.fine', { ns: 'fines' }),
      accessorFn: (row) => row.fee_name,
      card: 'subtitle',
    },
    {
      id: 'reason',
      header: t('columns.reason', { ns: 'fines' }),
      accessorFn: (row) => {
        const reason = truncatedReason(row.note);
        if (!reason) return '—';
        if (reason.short === reason.full) return reason.short;
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <span>{reason.short}</span>
            </TooltipTrigger>
            <TooltipContent>{reason.full}</TooltipContent>
          </Tooltip>
        );
      },
    },
    {
      id: 'incidentDate',
      header: t('columns.incidentDate', { ns: 'fines' }),
      accessorFn: (row) =>
        row.incident_date
          ? formatDate(parseServerDate(row.incident_date), regionConfig)
          : formatMonth(row.period_start.slice(0, 7), regionConfig),
    },
    {
      id: 'amount',
      header: t('columns.amount', { ns: 'fines' }),
      accessorFn: (row) => formatServerAmount(row.total_amount, regionConfig),
      align: 'end',
    },
    {
      id: 'paid',
      header: t('columns.paid', { ns: 'fines' }),
      accessorFn: (row) => formatServerAmount(row.paid_amount, regionConfig),
      align: 'end',
    },
    {
      id: 'status',
      header: t('columns.status', { ns: 'fines' }),
      accessorFn: (row) => <StatusBadge domain="fee" status={row.status as FeeStatus} />,
      card: 'badge',
    },
    {
      id: 'origin',
      header: t('columns.origin', { ns: 'fines' }),
      accessorFn: (row) =>
        fineOrigin(row) === 'RULE'
          ? t('origin.RULE', { ns: 'fines' })
          : t('origin.MANUAL', { ns: 'fines' }),
    },
  ];
}
