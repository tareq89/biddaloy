/**
 * [48.3.D-01] The "To print" groups: one card per exam (admit cards nobody has printed yet) and one
 * for ID cards never issued. Each card shows its first 5 people, "show N more" opens the rest in
 * place, and one print button hands the whole group to `/print/preview`.
 */
import { DocumentKind, PrintSubjectType } from '@biddaloy/shared';
import {
  Button,
  Card,
  DataTable,
  Skeleton,
  StatusBadge,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import { useAdmitCardRoster, type AdmitCardStudent, type IdCardQueueRow } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, formatNumber } from '@biddaloy/ui/utils';
import { Link } from '@tanstack/react-router';
import { PrinterIcon } from 'lucide-react';
import * as React from 'react';
import type { ReactNode } from 'react';

const FIRST = 5;
const BACK = '/reports/printables?tab=to-print';

/** The exam entry of `GET /print-history/queue`. */
export interface QueueExam {
  exam_id: string;
  exam_name: string;
  class_name: string;
  missing: number;
}

function Group<T extends object>({
  title,
  badge,
  lines,
  action,
  rows,
  columns,
  rowId,
  caption,
  loading,
}: {
  title: string;
  badge: string;
  lines: ReactNode;
  action: ReactNode;
  rows: T[];
  columns: DataTableColumn<T>[];
  rowId: (row: T) => string;
  caption: string;
  loading: boolean;
}) {
  const { t } = useTranslation('printHistory');
  const [all, setAll] = React.useState(false);
  const shown = all ? rows : rows.slice(0, FIRST);
  const rest = rows.length - shown.length;
  return (
    <Card padded className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 text-h3">
            {title}
            <StatusBadge tone="warning" label={badge} />
          </h3>
          {lines}
        </div>
        {action}
      </div>
      {loading ? (
        <Skeleton className="h-24 w-full" aria-busy="true" />
      ) : (
        <DataTable
          tableId={`to-print-${caption}`}
          caption={caption}
          columns={columns}
          data={shown}
          getRowId={rowId}
          sorting={null}
          onSortingChange={() => undefined}
          paginated={false}
          page={1}
          pageSize={shown.length || 1}
          totalCount={shown.length}
        />
      )}
      {rest > 0 ? (
        <Button type="button" variant="link" className="self-start" onClick={() => setAll(true)}>
          {t('toPrint.showRest', { count: rest })}
        </Button>
      ) : null}
    </Card>
  );
}

export function ExamGroup({ exam, filled }: { exam: QueueExam; filled: boolean }) {
  const { t } = useTranslation('printHistory');
  const region = useRegionConfig();
  const roster = useAdmitCardRoster(exam.exam_id);
  const waiting = [...(roster.data?.students ?? [])]
    .filter((s) => s.printed_copies === 0)
    .sort(
      (a, b) =>
        (a.section_name ?? '').localeCompare(b.section_name ?? '') || a.roll_number - b.roll_number,
    );
  const owing = waiting.filter((s) => s.has_dues).length;

  const columns: DataTableColumn<AdmitCardStudent>[] = [
    {
      id: 'roll',
      header: t('toPrint.col.roll'),
      accessorFn: (s) => formatNumber(s.roll_number, region),
    },
    {
      id: 'name',
      header: t('columns.person'),
      accessorFn: (s) => <span className="font-medium">{s.full_name}</span>,
      card: 'title',
    },
    { id: 'section', header: t('toPrint.col.section'), accessorFn: (s) => s.section_name ?? '—' },
    {
      id: 'dues',
      header: t('toPrint.col.dues'),
      accessorFn: (s) =>
        s.has_dues ? <StatusBadge tone="warning" label={t('toPrint.hasDues')} /> : '—',
      card: 'badge',
    },
  ];

  return (
    <Group
      title={t('toPrint.examLine', { exam: exam.exam_name, className: exam.class_name })}
      // The roster is the list below, so once it has loaded the badge counts what it shows.
      badge={t('toPrint.waiting', { count: roster.isSuccess ? waiting.length : exam.missing })}
      lines={
        owing > 0 ? <p className="text-warning">{t('toPrint.duesNote', { count: owing })}</p> : null
      }
      action={
        waiting.length > 0 ? (
          <Button asChild variant={filled ? 'default' : 'outline'}>
            <Link
              to="/print/preview"
              search={{
                kind: DocumentKind.EXAM_ADMIT_CARD,
                subject_type: PrintSubjectType.STUDENT,
                context_type: 'EXAM',
                context_id: exam.exam_id,
                ids: waiting.map((s) => s.student_id).join(','),
                from: BACK,
              }}
            >
              <PrinterIcon aria-hidden className="size-4" />
              {t('toPrint.printAdmit', { count: waiting.length })}
            </Link>
          </Button>
        ) : null
      }
      rows={waiting}
      columns={columns}
      rowId={(s) => s.student_id}
      caption={exam.exam_name}
      loading={roster.isPending}
    />
  );
}

export function IdCardGroup({ filled, rows }: { filled: boolean; rows: IdCardQueueRow[] }) {
  const { t } = useTranslation('printHistory');
  const region = useRegionConfig();
  const printable = rows.filter((r) => r.has_photo);
  const noPhoto = rows.length - printable.length;

  const columns: DataTableColumn<IdCardQueueRow>[] = [
    {
      id: 'registration',
      header: t('toPrint.col.registration'),
      accessorFn: (r) => r.registration_number ?? '—',
    },
    {
      id: 'name',
      header: t('columns.person'),
      accessorFn: (r) => <span className="font-medium">{r.full_name}</span>,
      card: 'title',
    },
    {
      id: 'class',
      header: t('toPrint.col.class'),
      accessorFn: (r) => [r.class_name, r.section_name].filter(Boolean).join(' · ') || '—',
    },
    {
      id: 'admitted',
      header: t('toPrint.col.admitted'),
      accessorFn: (r) => (r.admitted_on ? formatDate(new Date(r.admitted_on), region) : '—'),
    },
    {
      id: 'photo',
      header: t('toPrint.photo'),
      accessorFn: (r) =>
        r.has_photo ? (
          <StatusBadge tone="success" label={t('toPrint.photoYes')} />
        ) : (
          <span className="flex items-center gap-2">
            <StatusBadge tone="warning" label={t('toPrint.photoNo')} />
            <Link
              to="/students/$studentId"
              params={{ studentId: r.student_id }}
              search={{ tab: 'documents' }}
              className="text-primary underline"
            >
              {t('toPrint.addPhoto')}
            </Link>
          </span>
        ),
      card: 'badge',
    },
  ];

  return (
    <Group
      title={t('toPrint.neverIssued')}
      badge={t('toPrint.waiting', { count: rows.length })}
      lines={
        <>
          <p className="text-text-secondary">{t('toPrint.neverIssuedHelp')}</p>
          {noPhoto > 0 ? (
            <p className="text-warning">{t('toPrint.noPhoto', { count: noPhoto })}</p>
          ) : null}
        </>
      }
      action={
        printable.length > 0 ? (
          <Button asChild variant={filled ? 'default' : 'outline'}>
            <Link
              to="/print/preview"
              search={{
                kind: DocumentKind.STUDENT_ID_CARD,
                subject_type: PrintSubjectType.STUDENT,
                ids: printable.map((r) => r.student_id).join(','),
                from: BACK,
              }}
            >
              <PrinterIcon aria-hidden className="size-4" />
              {t('toPrint.printId', { count: printable.length })}
            </Link>
          </Button>
        ) : null
      }
      rows={rows}
      columns={columns}
      rowId={(r) => r.student_id}
      caption={t('toPrint.neverIssued')}
      loading={false}
    />
  );
}
