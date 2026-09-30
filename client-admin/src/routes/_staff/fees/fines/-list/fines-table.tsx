/**
 * [38.4.3] Columns for the `/fees/fines` list — student / fine type /
 * reason / incident date+month / amount / paid / status / origin / actions,
 * per the ticket's step 2.
 *
 * Plan correction: the ticket describes row actions as "an actions menu"
 * (Waive, Open student) — `@biddaloy/ui/components` has no dropdown-menu
 * primitive (only `UserMenu`, which is shell chrome, not a generic list).
 * Same as `fees/schedules/index.tsx`'s `ScheduleRowActions` and
 * `fees/dues.tsx`'s "Collect" link, the actions column renders inline
 * text-link buttons instead of a popup menu.
 */
import type { FeeStatus } from '@biddaloy/shared';
import {
  StatusBadge,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import type { Fine } from '@biddaloy/ui/hooks';
import type { RegionConfig } from '@biddaloy/ui/i18n';
import { formatDate, formatServerAmount, parseServerDate } from '@biddaloy/ui/utils';
import { Link } from '@tanstack/react-router';
import type { TFunction } from 'i18next';

function truncatedReason(note: string | null): { short: string; full: string } | null {
  if (!note) return null;
  const short = note.length > 40 ? `${note.slice(0, 40)}…` : note;
  return { short, full: note };
}

function fineOrigin(fine: Fine): 'RULE' | 'MANUAL' {
  return fine.origin ?? 'MANUAL';
}

export interface FinesTableCallbacks {
  onWaive: (fine: Fine) => void;
  /** Waiving needs FEE_APPROVE; without it the row action is hidden. */
  canWaive: boolean;
}

export function buildFinesColumns(
  t: TFunction<'fines', undefined>,
  regionConfig: RegionConfig,
  { onWaive, canWaive }: FinesTableCallbacks,
): DataTableColumn<Fine>[] {
  return [
    {
      id: 'student',
      header: t('columns.student', { ns: 'fines' }),
      accessorFn: (row) => (
        <Link
          to="/students/$studentId"
          params={{ studentId: row.student_id }}
          className="font-medium text-primary underline-offset-2 hover:underline"
        >
          {row.student_name ?? row.student_id}
        </Link>
      ),
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
          : row.period_start.slice(0, 7),
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
    {
      id: 'actions',
      header: t('columns.actions', { ns: 'fines' }),
      pinned: true,
      card: 'actions',
      accessorFn: (row) => (
        <div className="flex flex-wrap gap-3">
          {canWaive && row.status !== 'WAIVED' && row.status !== 'PAID' && (
            <button
              type="button"
              className="text-sm font-medium text-primary underline-offset-2 hover:underline"
              onClick={() => onWaive(row)}
            >
              {t('waiveDialog.confirm', { ns: 'fines' })}
            </button>
          )}
          <Link
            to="/students/$studentId"
            params={{ studentId: row.student_id }}
            className="text-sm font-medium text-primary underline-offset-2 hover:underline"
          >
            {t('openStudent', { ns: 'fines' })}
          </Link>
        </div>
      ),
    },
  ];
}
