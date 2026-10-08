/** [48.3.B-01] A student's issued certificates (Documents tab). A revoked row keeps its text and gets a badge + the reason (D39). */
import { Card, DataTable, StatusBadge, type DataTableColumn } from '@biddaloy/ui/components';
import { useCertificateRegister, type RegisterRow } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, formatNumber } from '@biddaloy/ui/utils';

export function IssuedCertificates({ studentId }: { studentId: string }) {
  const { t } = useTranslation('certificates');
  const { t: tKind } = useTranslation('printHistory');
  const region = useRegionConfig();
  const query = useCertificateRegister({ subject_id: studentId, limit: 50 });

  const columns: DataTableColumn<RegisterRow>[] = [
    {
      id: 'serial',
      header: t('documentsTab.cols.serial'),
      accessorFn: (r) => (
        <span>
          {r.serial}
          {r.copy_number > 1 ? (
            <span className="ms-2 text-caption text-text-secondary">
              {t('documentsTab.copy', { n: formatNumber(r.copy_number, region) })}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'kind',
      header: t('documentsTab.cols.kind'),
      accessorFn: (r) => tKind(`kind.${r.document_kind}`),
    },
    {
      id: 'issued',
      header: t('documentsTab.cols.issuedOn'),
      accessorFn: (r) => formatDate(r.issued_at, region),
    },
    {
      id: 'status',
      header: t('documentsTab.cols.status'),
      accessorFn: (r) =>
        r.revoked_at ? (
          <div className="flex flex-col gap-1">
            <StatusBadge tone="neutral" label={tKind('status.REVOKED')} />
            {r.revoke_reason ? (
              <span className="text-caption text-text-secondary">
                {t('documentsTab.revokedReason', { reason: r.revoke_reason })}
              </span>
            ) : null}
          </div>
        ) : (
          <StatusBadge tone="success" label={t('documentsTab.valid')} />
        ),
    },
  ];

  return (
    <Card padded>
      <h2 className="text-h2">{t('documentsTab.issuedTitle')}</h2>
      <div className="mt-4">
        <DataTable
          columns={columns}
          data={query.data?.data ?? []}
          getRowId={(r) => r.item_id}
          sorting={null}
          onSortingChange={() => undefined}
          totalCount={query.data?.total ?? 0}
          paginated={false}
          tableId="student-issued-certificates"
          caption={t('documentsTab.issuedTitle')}
          loading={query.isPending}
          {...(query.isError ? { error: tKind('register.empty') } : {})}
          emptyMessage={t('documentsTab.empty')}
        />
      </div>
    </Card>
  );
}
