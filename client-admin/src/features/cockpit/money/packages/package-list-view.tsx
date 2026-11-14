/**
 * #3884 The packages list: name, SMS, price, validity and an on/off switch in every row, so the
 * state shows without opening a row. Presentational: the route owns the hooks and the dialog.
 * Packages are switched off, never deleted (D22).
 */
import { Button, DataTable, Switch, type DataTableColumn } from '@biddaloy/ui/components';
import type { SmsPackage } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatCurrency, formatNumber } from '@biddaloy/ui/utils';

export interface PackageListViewProps {
  packages: SmsPackage[];
  loading?: boolean;
  error?: boolean;
  onRetry: () => void;
  onNew: () => void;
  onRecordStock: () => void;
  onEdit: (pkg: SmsPackage) => void;
  onToggle: (pkg: SmsPackage, active: boolean) => void;
  /** Id of the package whose switch is saving. */
  busyId?: string | undefined;
  switchError?: boolean;
}

export function PackageListView(props: PackageListViewProps) {
  const { packages, loading, error, onRetry, onNew, onRecordStock, onEdit, onToggle } = props;
  const { t } = useTranslation('moneyPackages');
  const config = useRegionConfig();

  const columns: DataTableColumn<SmsPackage>[] = [
    { id: 'name', header: t('list.name'), accessorFn: (r) => r.name, card: 'title' },
    {
      id: 'smsCount',
      header: t('list.smsCount'),
      accessorFn: (r) => formatNumber(r.smsCount, config),
      align: 'end',
    },
    {
      id: 'price',
      header: t('list.price'),
      accessorFn: (r) => formatCurrency(Number(r.pricePaisa), config),
      align: 'end',
    },
    {
      id: 'validity',
      header: t('list.validity'),
      accessorFn: (r) => t('list.days', { count: r.validityDays }),
    },
    {
      id: 'active',
      header: t('list.on'),
      accessorFn: (r) => (
        <Switch
          checked={r.active}
          disabled={props.busyId === r.id}
          aria-label={t('list.switch', { name: r.name })}
          onCheckedChange={(next) => onToggle(r, next)}
        />
      ),
    },
  ];

  return (
    <section aria-labelledby="packages-title" className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="packages-title" className="text-heading-3 font-semibold">
          {t('title')}
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button type="button" className="min-h-11 md:min-h-0" onClick={onNew}>
            {t('new')}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 md:min-h-0"
            onClick={onRecordStock}
          >
            {t('recordStock')}
          </Button>
        </div>
      </div>
      <p className="text-caption text-text-secondary">{t('note')}</p>
      {props.switchError && (
        <p role="alert" className="text-caption text-destructive">
          {t('list.switchError')}
        </p>
      )}
      {error ? (
        <div role="alert" className="flex items-center gap-3 text-destructive">
          <span>{t('loadError')}</span>
          <Button type="button" variant="outline" onClick={onRetry}>
            {t('retry')}
          </Button>
        </div>
      ) : (
        <DataTable
          tableId="money-sms-packages"
          caption={t('list.caption')}
          columns={columns}
          data={packages}
          getRowId={(r) => r.id}
          sorting={null}
          onSortingChange={() => undefined}
          totalCount={packages.length}
          paginated={false}
          loading={loading ?? false}
          emptyState={{ title: t('empty.title'), explanation: t('empty.description') }}
          rowActions={(row) => [
            { intent: 'edit', label: t('list.edit'), onClick: () => onEdit(row) },
          ]}
        />
      )}
    </section>
  );
}
