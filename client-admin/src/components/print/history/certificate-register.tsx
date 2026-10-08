/**
 * [48.3.D-01] Certificate register: every issued certificate by serial. A `ListShell` like the print
 * history. A revoked row stays in the list with its reason under the student (no strike-through, D39).
 * The route owns `validateSearch` and passes `search` in (D60).
 */
import {
  type DocumentKind,
  isSerialKind,
  isStudentCertificateKind,
  Permission,
} from '@biddaloy/shared';
import { StatusBadge, type DataTableColumn } from '@biddaloy/ui/components';
import {
  downloadCertificateRegisterCsv,
  useCertificateRegister,
  useHasPermission,
  usePrintHistoryItem,
  type RegisterRow,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation, type RegionConfig } from '@biddaloy/ui/i18n';
import { ListShell, type FilterFieldDescriptor } from '@biddaloy/ui/shells';
import { formatDate, formatNumber, renderDigits, toLatinDigits } from '@biddaloy/ui/utils';
import { FileDownIcon, ScrollTextIcon } from 'lucide-react';
import * as React from 'react';
import type { ReactNode } from 'react';

import { PRINT_KIND_ORDER } from '../library/suggestion-card';

import { HistoryItemDialog } from './history-item-dialog';
import { toRegisterFilters, type PrintHistorySearch } from './print-history-filters';
import { ReprintDialog } from './reprint-dialog';
import { RevokeDialog } from './revoke-dialog';

export interface CertificateRegisterProps {
  search: PrintHistorySearch;
  onSearchChange: (patch: Record<string, string | number | null>) => void;
  tabs?: ReactNode;
}

/** This year on the school's clock (the long date always ends in the year). */
export function currentYear(region: RegionConfig, now = new Date()): number {
  return Number(/\d{4}/.exec(toLatinDigits(formatDate(now, region)))?.[0] ?? now.getFullYear());
}

/** Loads the job id the reprint needs, then opens the reprint dialog. */
function RegisterReprint({ itemId, onClose }: { itemId: string; onClose: () => void }) {
  const item = usePrintHistoryItem(itemId);
  if (!item.data) return null;
  return (
    <ReprintDialog
      key={item.data.item_id}
      open
      onOpenChange={(open) => !open && onClose()}
      row={item.data}
      channel={isStudentCertificateKind(item.data.document_kind) ? 'certificate' : 'document'}
    />
  );
}

export function CertificateRegister({ search, onSearchChange, tabs }: CertificateRegisterProps) {
  const { t } = useTranslation('printHistory');
  const region = useRegionConfig();
  const canPrint = useHasPermission(Permission.DOCUMENT_PRINT);
  const canIssue = useHasPermission(Permission.CERTIFICATE_ISSUE);
  const canRevoke = useHasPermission(Permission.DOCUMENT_REVOKE);
  const query = useCertificateRegister(toRegisterFilters(search));
  const rows = query.data?.data ?? [];
  const total = query.data?.total ?? 0;

  const [viewId, setViewId] = React.useState<string | undefined>(undefined);
  const [reprintId, setReprintId] = React.useState<string | undefined>(undefined);
  const [revoke, setRevoke] = React.useState<{ id: string; label: string } | undefined>(undefined);
  const [exporting, setExporting] = React.useState(false);

  // The row type is the certificate subset; the view dialog hands over any DocumentKind.
  const mayReprint = (kind: string) =>
    isStudentCertificateKind(kind as DocumentKind) ? canIssue : canPrint;
  const year = (y: number) => renderDigits(String(y), region.numerals);
  const heading =
    search.year !== undefined
      ? t('register.heading', { count: total, year: year(search.year) })
      : t('register.headingAll', { count: total });

  const columns: DataTableColumn<RegisterRow>[] = [
    {
      id: 'serial',
      header: t('register.col.serial'),
      accessorFn: (row) => <span className="font-medium">{row.serial}</span>,
      card: 'title',
    },
    {
      id: 'kind',
      header: t('register.col.kind'),
      accessorFn: (row) => t(`kind.${row.document_kind}`),
    },
    {
      id: 'student',
      header: t('register.col.student'),
      accessorFn: (row) => (
        <>
          {row.subject_label}
          {row.class_name ? <span className="text-text-secondary"> · {row.class_name}</span> : null}
          {row.revoked_at && row.revoke_reason ? (
            <span className="block text-caption text-destructive">
              {t('register.revokeReason')} {row.revoke_reason}
            </span>
          ) : null}
        </>
      ),
      card: 'subtitle',
    },
    {
      id: 'issued',
      header: t('register.col.issuedOn'),
      accessorFn: (row) => formatDate(new Date(row.issued_at), region),
    },
    {
      id: 'by',
      header: t('register.col.issuedBy'),
      accessorFn: (row) => row.printed_by_name ?? t('system'),
    },
    {
      id: 'copy',
      header: t('register.col.copy'),
      accessorFn: (row) =>
        row.copy_number > 1
          ? t('register.duplicate', { n: formatNumber(row.copy_number, region) })
          : formatNumber(row.copy_number, region),
      align: 'end',
    },
    {
      id: 'status',
      header: t('columns.status'),
      accessorFn: (row) =>
        row.revoked_at ? (
          <StatusBadge tone="danger" label={t('register.revoked')} />
        ) : (
          <StatusBadge tone="success" label={t('register.valid')} />
        ),
      card: 'badge',
    },
  ];

  const thisYear = currentYear(region);
  const filterFields: FilterFieldDescriptor[] = [
    {
      kind: 'text',
      key: 'q',
      label: t('filters.search'),
      placeholder: t('register.searchPlaceholder'),
      primary: true,
    },
    {
      kind: 'select',
      key: 'document_kind',
      label: t('filters.kind'),
      allLabel: t('filters.allKinds'),
      options: PRINT_KIND_ORDER.filter(isSerialKind).map((k) => ({
        value: k,
        label: t(`kind.${k}`),
      })),
    },
    {
      kind: 'select',
      key: 'year',
      label: t('register.year'),
      allLabel: t('register.allYears'),
      options: [0, 1, 2, 3, 4].map((back) => ({
        value: String(thisYear - back),
        label: year(thisYear - back),
      })),
    },
    {
      kind: 'select',
      key: 'status',
      label: t('register.status'),
      allLabel: t('register.allStatus'),
      options: [
        { value: 'VALID', label: t('register.valid') },
        { value: 'REVOKED', label: t('register.revoked') },
      ],
    },
  ];

  const values = Object.fromEntries(
    (['q', 'document_kind', 'year', 'status'] as const).flatMap((key) =>
      search[key] !== undefined ? [[key, String(search[key])]] : [],
    ),
  );

  return (
    <>
      <ListShell
        title={t('title')}
        subtitle={t('subtitle')}
        actions={[
          {
            id: 'export',
            label: t('register.export'),
            icon: <FileDownIcon aria-hidden className="size-4" />,
            priority: 'secondary',
            busy: exporting,
            onClick: () => {
              setExporting(true);
              void downloadCertificateRegisterCsv(toRegisterFilters(search)).finally(() =>
                setExporting(false),
              );
            },
          },
        ]}
        {...(tabs ? { tabs } : {})}
        filters={{
          fields: filterFields,
          values,
          // A changed filter starts again from page 1.
          onChange: (patch) => onSearchChange({ ...patch, page: null }),
        }}
        tableId="certificate-register"
        caption={heading}
        columns={columns}
        data={rows}
        getRowId={(row) => row.item_id}
        sorting={null}
        onSortingChange={() => undefined}
        page={search.page ?? 1}
        pageSize={search.limit ?? 25}
        totalCount={total}
        onPageChange={(page) => onSearchChange({ page })}
        onPageSizeChange={(limit) => onSearchChange({ limit, page: null })}
        pageSizeLabel={t('pagination.rowsPerPage', { ns: 'common' })}
        loading={query.isLoading}
        isFetching={query.isFetching}
        {...(query.isError ? { error: t('loadError') } : {})}
        rowActions={(row) => [
          { intent: 'view', label: t('actions.view'), onClick: () => setViewId(row.item_id) },
          {
            intent: 'print',
            label: t('actions.reprint'),
            onClick: () => setReprintId(row.item_id),
            allowed: mayReprint(row.document_kind) && !row.revoked_at,
          },
          {
            intent: 'reject',
            label: t('actions.revoke'),
            onClick: () => setRevoke({ id: row.item_id, label: row.subject_label }),
            allowed: canRevoke && !row.revoked_at,
          },
        ]}
        emptyState={{
          title: t('register.empty'),
          explanation: t('register.emptyExplanation'),
          icon: <ScrollTextIcon aria-hidden className="size-5" />,
        }}
        announceResults={(count, all) => t('register.announce', { visible: count, total: all })}
      />

      <HistoryItemDialog
        open={viewId !== undefined}
        onOpenChange={(open) => !open && setViewId(undefined)}
        itemId={viewId}
        canReprint={(item) => mayReprint(item.document_kind)}
        onReprint={(item) => {
          setViewId(undefined);
          setReprintId(item.item_id);
        }}
        {...(canRevoke
          ? {
              onRevoke: (item) => {
                setViewId(undefined);
                setRevoke({ id: item.item_id, label: item.subject_label });
              },
            }
          : {})}
      />
      {reprintId ? (
        <RegisterReprint itemId={reprintId} onClose={() => setReprintId(undefined)} />
      ) : null}
      {revoke ? (
        <RevokeDialog
          open
          onOpenChange={(open) => !open && setRevoke(undefined)}
          itemId={revoke.id}
          subjectLabel={revoke.label}
        />
      ) : null}
    </>
  );
}
